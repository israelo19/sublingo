import type { PlayerAdapter } from '@/lib/player/types';
import { indexAtOrBefore } from '@/lib/subtitles/active';
import type { Cue } from '@/lib/subtitles/types';
import { SpeechCalibrator, planCue, shouldDuck } from './plan';
import { isSpeakable, speakableText } from './speakable';

export type DubSource = 'youtube' | 'azure' | 'browser' | 'none';

export interface ClipHandle {
  /** Resolves when the clip finished or was cancelled; `actualSec` is the measured length when known. */
  done: Promise<{ actualSec?: number }>;
  cancel(): void;
  pause(): void;
  resume(): void;
}

export interface DubVoiceProvider {
  readonly name: 'azure' | 'browser';
  /** Start generating audio for a cue ahead of time (optional). */
  prepare?(cue: Cue, index: number): void;
  /** Exact clip length in seconds when known (Azure); undefined lets the engine estimate. */
  durationOf?(cue: Cue): Promise<number | undefined>;
  speak(cue: Cue, index: number, speechRate: number): Promise<ClipHandle | undefined>;
  cancelAll(): void;
}

export interface DubEngineOptions {
  /** Original audio volume while dialogue plays, 0-1. */
  duck: number;
  /** Slow the video slightly so long lines fit; otherwise the voice speeds up instead. */
  slowVideo: boolean;
  prefetch: number;
  onStatus?(message: string): void;
}

/** Start a line this many seconds early to hide voice start-up latency. */
const LEAD_SEC = 0.15;
/** Let a line run this far into the next one before cutting it. */
const MAX_OVERLAP_SEC = 0.5;
/** Forward jumps larger than this, or any backward movement beyond jitter, count as a seek. */
const SEEK_FORWARD_SEC = 1.5;
const SEEK_BACKWARD_SEC = 0.3;
const FADE_MS = 120;

/**
 * Plays one dubbed clip per caption cue, in sync with the video.
 *
 * Seamlessness comes from three rules: the original audio stays ducked (with short fades) for
 * as long as dialogue is active or imminent, so no original speech leaks between lines; a
 * line is fitted into its slot by slowing the video rather than rushing the voice; and the
 * next line is not cut off mid-word for a small overlap.
 */
export class DubEngine {
  private cues: Cue[] = [];
  private current?: { index: number; handle: ClipHandle };
  private starting?: number;
  private lastSpoken = -1;
  private lastTime = -1;
  private stopped = false;
  private readonly calibrator = new SpeechCalibrator();

  // ducking
  private ducked = false;
  private baseVolume?: number;
  private lastSetVolume?: number;
  private fadeTimer?: number;

  // pacing
  private paced = false;
  private baseRate?: number;
  private pacedRate?: number;

  constructor(
    private readonly player: PlayerAdapter,
    private readonly video: () => HTMLVideoElement | null,
    private readonly provider: DubVoiceProvider,
    private opts: DubEngineOptions,
  ) {}

  /** Change duck level / pacing without rebuilding the engine. */
  setOptions(patch: Partial<Pick<DubEngineOptions, 'duck' | 'slowVideo'>>): void {
    this.opts = { ...this.opts, ...patch };
    if (this.ducked) {
      const v = this.video();
      if (v) this.fadeTo(v, Math.min(this.baseVolume ?? v.volume, Math.max(0, this.opts.duck)));
    }
  }

  setCues(cues: Cue[]): void {
    this.cues = cues;
    this.cancelCurrent();
    this.lastSpoken = -1;
  }

  /** Swap in cues whose timing is unchanged (e.g. better translations) without interrupting speech. */
  updateCueTexts(cues: Cue[]): void {
    if (cues.length !== this.cues.length) {
      this.setCues(cues);
      return;
    }
    this.cues = cues;
  }

  /** Warm the cache around a time so the first lines are ready when playback reaches them. */
  prime(t: number): void {
    const from = Math.max(0, indexAtOrBefore(this.cues, t));
    this.prefetchFrom(from);
  }

  /** An ad (or anything else that takes over the player) is showing: go quiet and hands-off. */
  suspend(): void {
    this.cancelCurrent();
    this.setDuck(false);
    this.lastTime = -1;
  }

  onTick(t: number, paused: boolean, activeIndex: number): void {
    if (this.stopped) return;
    const seeked = this.lastTime >= 0 && (t - this.lastTime > SEEK_FORWARD_SEC || t < this.lastTime - SEEK_BACKWARD_SEC);
    this.lastTime = t;

    if (seeked) {
      this.cancelCurrent();
      this.lastSpoken = -1;
      this.prime(t);
    }

    if (paused) {
      this.current?.handle.pause();
      this.setDuck(false);
      return;
    }

    // Treat an imminent next line as the target so the voice starts right on cue.
    let target = activeIndex;
    const next = indexAtOrBefore(this.cues, t) + 1;
    if (next < this.cues.length && this.cues[next].start - t <= LEAD_SEC) target = next;

    this.setDuck(shouldDuck(this.cues, t, Boolean(this.current) || this.starting !== undefined));

    if (this.current) {
      if (target < 0 || this.current.index === target) {
        this.current.handle.resume();
        return;
      }
      // A new line is due while the previous one is still speaking: tolerate a small overlap.
      if (t - this.cues[target].start < MAX_OVERLAP_SEC) return;
      this.cancelCurrent();
    }

    if (target < 0 || this.starting === target || this.lastSpoken === target) return;
    const cue = this.cues[target];
    if (!cue || !isSpeakable(cue.text)) return;
    // Do not start a line we are already well into (e.g. after a seek into its middle).
    if (t - cue.start > Math.max(0.8, 0.6 * (cue.end - cue.start))) return;
    void this.start(target, cue);
  }

  private prefetchFrom(index: number) {
    let queued = 0;
    for (let i = index; i < this.cues.length && queued < this.opts.prefetch; i++) {
      const c = this.cues[i];
      if (!isSpeakable(c.text)) continue;
      this.provider.prepare?.({ ...c, text: speakableText(c.text) }, i);
      queued++;
    }
  }

  private async start(index: number, cue: Cue): Promise<void> {
    this.starting = index;
    this.prefetchFrom(index + 1);
    const spoken: Cue = { ...cue, text: speakableText(cue.text) };
    const nextStart = this.cues[index + 1]?.start ?? cue.end + 2;
    const windowSec = Math.max(0.4, nextStart - cue.start - 0.05);

    let duration = (await this.provider.durationOf?.(spoken).catch(() => undefined)) ?? undefined;
    if (this.starting !== index || this.stopped) return;
    // The viewer may have paused during the wait; do not speak over a frozen frame.
    if (this.player.paused()) {
      this.starting = undefined;
      return;
    }
    if (!duration) duration = this.calibrator.estimate(spoken.text);
    const plan = planCue(duration, windowSec, this.opts.slowVideo);
    this.applyVideoRate(plan.videoRate);

    let handle: ClipHandle | undefined;
    try {
      handle = await this.provider.speak(spoken, index, plan.speechRate);
    } catch (err) {
      this.opts.onStatus?.(err instanceof Error ? err.message : String(err));
    }
    if (this.starting !== index) {
      handle?.cancel();
      return;
    }
    this.starting = undefined;
    if (!handle || this.stopped) {
      this.restoreVideoRate();
      return;
    }
    this.current = { index, handle };
    if (this.player.paused()) handle.pause();
    void handle.done.then(({ actualSec }) => {
      if (this.current?.handle !== handle) return;
      this.current = undefined;
      this.lastSpoken = index;
      this.restoreVideoRate();
      if (actualSec && this.provider.name === 'browser') this.calibrator.observe(spoken.text, actualSec * plan.speechRate);
    });
  }

  // ---------- video pacing ----------

  private applyVideoRate(multiplier: number) {
    const v = this.video();
    if (!v) return;
    if (multiplier >= 0.999) {
      this.restoreVideoRate();
      return;
    }
    if (!this.paced) {
      this.baseRate = v.playbackRate || 1;
      this.paced = true;
    }
    this.pacedRate = Math.round((this.baseRate ?? 1) * multiplier * 100) / 100;
    v.playbackRate = this.pacedRate;
  }

  private restoreVideoRate() {
    const v = this.video();
    if (v && this.paced && this.baseRate !== undefined) {
      // If the viewer changed speed while we were pacing, respect their choice instead.
      if (this.pacedRate === undefined || Math.abs(v.playbackRate - this.pacedRate) < 0.01) v.playbackRate = this.baseRate;
    }
    this.paced = false;
    this.pacedRate = undefined;
  }

  // ---------- ducking with fades ----------

  private setDuck(on: boolean) {
    const v = this.video();
    if (!v) return;
    // If the viewer moved the volume while we were ducked (and no fade is running), adopt it as the base.
    if (this.ducked && !this.fadeTimer && this.lastSetVolume !== undefined && Math.abs(v.volume - this.lastSetVolume) > 0.03) {
      this.baseVolume = v.volume;
    }
    if (on === this.ducked) return;
    // Snapshot the base only from a settled (not mid-fade) level, so rapid flips never ratchet it down.
    if (on && !this.fadeTimer) this.baseVolume = v.volume;
    this.ducked = on;
    const base = this.baseVolume ?? v.volume;
    this.fadeTo(v, on ? Math.min(base, Math.max(0, this.opts.duck)) : base);
  }

  private fadeTo(v: HTMLVideoElement, target: number) {
    if (this.fadeTimer) window.clearInterval(this.fadeTimer);
    const from = v.volume;
    const steps = Math.max(1, Math.round(FADE_MS / 15));
    let step = 0;
    this.fadeTimer = window.setInterval(() => {
      step++;
      const value = from + (target - from) * Math.min(1, step / steps);
      v.volume = Math.max(0, Math.min(1, value));
      this.lastSetVolume = v.volume;
      if (step >= steps && this.fadeTimer) {
        window.clearInterval(this.fadeTimer);
        this.fadeTimer = undefined;
      }
    }, 15);
  }

  // ---------- lifecycle ----------

  private cancelCurrent() {
    this.starting = undefined;
    if (this.current) {
      this.current.handle.cancel();
      this.current = undefined;
    }
    this.restoreVideoRate();
  }

  stop(): void {
    this.stopped = true;
    this.cancelCurrent();
    this.provider.cancelAll();
    if (this.fadeTimer) {
      window.clearInterval(this.fadeTimer);
      this.fadeTimer = undefined;
    }
    const v = this.video();
    if (v && this.ducked && this.baseVolume !== undefined) v.volume = this.baseVolume;
    this.ducked = false;
  }
}

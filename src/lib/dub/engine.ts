import type { PlayerAdapter } from '@/lib/player/types';
import type { Cue } from '@/lib/subtitles/types';
import { isSpeakable, speakableText } from './speakable';

export type DubSource = 'youtube' | 'azure' | 'browser' | 'none';

export interface ClipHandle {
  done: Promise<void>;
  cancel(): void;
  pause(): void;
  resume(): void;
}

export interface DubVoiceProvider {
  readonly name: 'azure' | 'browser';
  /** Start generating audio for a cue ahead of time (optional). */
  prepare?(cue: Cue, index: number): void;
  /**
   * Speak one cue. `windowSec` is the time until the next cue starts; providers fit the
   * clip into it (faster speech) and report the rate they chose via `onFit`.
   */
  speak(cue: Cue, index: number, windowSec: number, onFit: (fit: { rate: number; overflowSec: number }) => void): Promise<ClipHandle | undefined>;
  cancelAll(): void;
}

export interface DubEngineOptions {
  /** Original audio volume while a dubbed line plays, 0-1. */
  duck: number;
  /** Slow the video slightly when a clip overflows its window even at max speed. */
  slowVideo: boolean;
  prefetch: number;
  onStatus?(message: string): void;
}

const MAX_RATE = 1.3;
const MIN_VIDEO_RATE = 0.8;

/**
 * Plays one dubbed clip per caption cue, in sync with the video. Ducks the original audio
 * while a clip plays and restores it in the gaps, so music and ambience survive.
 */
export class DubEngine {
  private cues: Cue[] = [];
  private current?: { index: number; handle: ClipHandle };
  private starting?: number;
  private lastTime = -1;
  private originalVolume?: number;
  private originalRate?: number;
  private stopped = false;
  private ducked = false;

  constructor(
    private readonly player: PlayerAdapter,
    private readonly video: () => HTMLVideoElement | null,
    private readonly provider: DubVoiceProvider,
    private readonly opts: DubEngineOptions,
  ) {}

  setCues(cues: Cue[]): void {
    this.cues = cues;
    this.cancelCurrent();
  }

  onTick(t: number, paused: boolean, activeIndex: number): void {
    if (this.stopped) return;
    const seeked = this.lastTime >= 0 && Math.abs(t - this.lastTime) > 1.5;
    this.lastTime = t;

    if (paused) {
      this.current?.handle.pause();
      this.unduck();
      return;
    }

    if (seeked) this.cancelCurrent();

    if (this.current && this.current.index !== activeIndex && activeIndex >= 0) {
      // The video moved on to the next line: cut the previous clip so we never lag behind.
      this.cancelCurrent();
    } else if (this.current) {
      this.current.handle.resume();
      return;
    }

    if (activeIndex < 0 || this.starting === activeIndex) return;
    const cue = this.cues[activeIndex];
    if (!cue || !isSpeakable(cue.text)) return;
    // Do not start a line we are already more than 60% through (e.g. after a seek).
    if (t - cue.start > Math.max(0.8, 0.6 * (cue.end - cue.start))) return;
    void this.start(activeIndex, cue);
  }

  private async start(index: number, cue: Cue): Promise<void> {
    this.starting = index;
    const next = this.cues[index + 1];
    const windowSec = Math.max(0.5, (next ? next.start : cue.end + 1.5) - cue.start);
    for (let i = 1; i <= this.opts.prefetch; i++) {
      const c = this.cues[index + i];
      if (c && isSpeakable(c.text)) this.provider.prepare?.({ ...c, text: speakableText(c.text) }, index + i);
    }
    let handle: ClipHandle | undefined;
    try {
      handle = await this.provider.speak({ ...cue, text: speakableText(cue.text) }, index, windowSec, (fit) => this.applyFit(fit, windowSec));
    } catch (err) {
      this.opts.onStatus?.(err instanceof Error ? err.message : String(err));
    }
    if (this.starting !== index) {
      handle?.cancel();
      return;
    }
    this.starting = undefined;
    if (!handle || this.stopped) return;
    this.current = { index, handle };
    this.duck();
    void handle.done.finally(() => {
      if (this.current?.handle === handle) {
        this.current = undefined;
        this.unduck();
        this.restoreRate();
      }
    });
  }

  private applyFit(fit: { rate: number; overflowSec: number }, windowSec: number) {
    const v = this.video();
    if (!v || !this.opts.slowVideo || fit.overflowSec <= 0.15) return;
    // Slow the video so the clip fits: needed window = windowSec + overflow.
    const rate = Math.max(MIN_VIDEO_RATE, windowSec / (windowSec + fit.overflowSec));
    if (this.originalRate === undefined) this.originalRate = v.playbackRate;
    v.playbackRate = Math.round(rate * 20) / 20;
  }

  private restoreRate() {
    const v = this.video();
    if (v && this.originalRate !== undefined) {
      v.playbackRate = this.originalRate;
      this.originalRate = undefined;
    }
  }

  private duck() {
    const v = this.video();
    if (!v || this.ducked) return;
    this.originalVolume = v.volume;
    v.volume = Math.min(v.volume, Math.max(0, this.opts.duck));
    this.ducked = true;
  }

  private unduck() {
    const v = this.video();
    if (!v || !this.ducked) return;
    if (this.originalVolume !== undefined) v.volume = this.originalVolume;
    this.ducked = false;
  }

  private cancelCurrent() {
    this.starting = undefined;
    if (this.current) {
      this.current.handle.cancel();
      this.current = undefined;
    }
    this.unduck();
    this.restoreRate();
  }

  stop(): void {
    this.stopped = true;
    this.cancelCurrent();
    this.provider.cancelAll();
  }
}

export { MAX_RATE };

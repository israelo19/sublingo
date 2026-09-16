import { browser } from '#imports';
import type { AzureTtsResponse } from '@/lib/messages';
import type { Cue } from '@/lib/subtitles/types';
import { pickBrowserVoice, speakBrowser } from '@/lib/tts/browser';
import type { ClipHandle, DubVoiceProvider } from './engine';

/** Free, offline voice from the operating system through speechSynthesis. */
export class BrowserVoiceProvider implements DubVoiceProvider {
  readonly name = 'browser' as const;
  private voice?: SpeechSynthesisVoice;
  private readonly ready: Promise<void>;
  private active?: { cancel(): void };

  constructor(
    private readonly lang: string,
    preferredName: string,
    private readonly onBlocked?: () => void,
  ) {
    this.ready = pickBrowserVoice(lang, preferredName || undefined).then((v) => {
      this.voice = v;
    });
  }

  async speak(cue: Cue, _index: number, speechRate: number): Promise<ClipHandle | undefined> {
    await this.ready;
    if (!globalThis.speechSynthesis) return undefined;
    const startedAt = performance.now();
    const h = speakBrowser(cue.text, { lang: this.lang, voice: this.voice, rate: speechRate });
    this.active = h;
    const done = h.done.then((result) => {
      if (result === 'error') this.onBlocked?.();
      return { actualSec: result === 'ended' ? (performance.now() - startedAt) / 1000 : undefined };
    });
    return { done, cancel: () => h.cancel(), pause: () => h.pause(), resume: () => h.resume() };
  }

  cancelAll(): void {
    this.active?.cancel();
    globalThis.speechSynthesis?.cancel();
  }
}

interface Clip {
  url: string;
  /** Seconds; 0 when unknown. */
  duration: number;
}

const CLIP_WAIT_MS = 900;
const FAILURE_RETRY_MS = 15000;
const MAX_CACHED_CLIPS = 80;

/**
 * Azure neural voice, synthesized in the background worker and cached there.
 *
 * Clips are kept as blob URLs plus a decoded duration; only two <audio> elements ever exist
 * (Chrome caps media players per document at about 75), alternating so the next line can be
 * preloaded while the current one plays. The browser voice fills in when a clip is late.
 */
export class AzureVoiceProvider implements DubVoiceProvider {
  readonly name = 'azure' as const;
  private readonly clips = new Map<string, Promise<Clip | undefined>>();
  private readonly failedAt = new Map<string, number>();
  private readonly elements = [new Audio(), new Audio()];
  private elementIndex = 0;
  private audioContext?: AudioContext;
  private active?: ClipHandle;

  constructor(
    private readonly lang: string,
    private readonly fallback: BrowserVoiceProvider | undefined,
    private readonly onStatus: (message: string) => void,
  ) {
    for (const el of this.elements) el.preload = 'auto';
  }

  private key(cue: Cue) {
    return `${cue.start.toFixed(2)}|${cue.text}`;
  }

  prepare(cue: Cue): void {
    const k = this.key(cue);
    if (this.clips.has(k)) return;
    const failed = this.failedAt.get(k);
    if (failed && Date.now() - failed < FAILURE_RETRY_MS) return;
    const p = this.fetchClip(cue).catch((err) => {
      this.onStatus(err instanceof Error ? err.message : String(err));
      this.failedAt.set(k, Date.now());
      this.clips.delete(k); // allow a retry later instead of caching the failure forever
      return undefined;
    });
    this.clips.set(k, p);
    if (this.clips.size > MAX_CACHED_CLIPS) {
      const oldest = this.clips.keys().next().value as string;
      void this.clips.get(oldest)?.then((c) => c && URL.revokeObjectURL(c.url));
      this.clips.delete(oldest);
    }
  }

  private async decodeDuration(bytes: Uint8Array): Promise<number> {
    try {
      this.audioContext ??= new AudioContext();
      const buffer = await this.audioContext.decodeAudioData(bytes.slice().buffer);
      return Number.isFinite(buffer.duration) ? buffer.duration : 0;
    } catch {
      return 0;
    }
  }

  private async fetchClip(cue: Cue): Promise<Clip | undefined> {
    const res = (await browser.runtime.sendMessage({ type: 'tts-azure', text: cue.text, lang: this.lang })) as AzureTtsResponse;
    if ('error' in res) throw new Error(res.error);
    const bytes = Uint8Array.from(atob(res.audio), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: res.mime }));
    return { url, duration: await this.decodeDuration(bytes) };
  }

  private readyClip(cue: Cue): Promise<Clip | undefined> {
    this.prepare(cue);
    const pending = this.clips.get(this.key(cue));
    if (!pending) return Promise.resolve(undefined);
    return Promise.race([pending, new Promise<undefined>((r) => setTimeout(() => r(undefined), CLIP_WAIT_MS))]);
  }

  async durationOf(cue: Cue): Promise<number | undefined> {
    const clip = await this.readyClip(cue);
    return clip && clip.duration > 0 ? clip.duration : undefined;
  }

  async speak(cue: Cue, index: number, speechRate: number): Promise<ClipHandle | undefined> {
    const clip = await this.readyClip(cue);
    if (!clip) return this.speakFallback(cue, index, speechRate, 'Azure clip not ready, using the browser voice for this line');

    const audio = this.elements[this.elementIndex];
    this.elementIndex = (this.elementIndex + 1) % this.elements.length;
    if (audio.src !== clip.url) audio.src = clip.url;
    audio.playbackRate = speechRate;
    audio.currentTime = 0;
    let settle: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => (settle = resolve));
    audio.onended = () => settle();
    audio.onerror = () => settle();
    try {
      await audio.play();
    } catch (err) {
      settle();
      if (err instanceof Error && err.name === 'NotAllowedError') {
        this.onStatus('Click the video once to allow dubbed audio');
        return undefined;
      }
      return this.speakFallback(cue, index, speechRate, 'Audio playback failed, using the browser voice for this line');
    }
    const handle: ClipHandle = {
      done: finished.then(() => ({ actualSec: clip.duration > 0 ? clip.duration / speechRate : undefined })),
      cancel: () => {
        audio.pause();
        settle();
      },
      pause: () => audio.pause(),
      resume: () => {
        if (audio.paused && !audio.ended) void audio.play().catch(() => undefined);
      },
    };
    this.active = handle;
    return handle;
  }

  private speakFallback(cue: Cue, index: number, speechRate: number, message: string): Promise<ClipHandle | undefined> {
    if (!this.fallback) return Promise.resolve(undefined);
    this.onStatus(message);
    return this.fallback.speak(cue, index, speechRate);
  }

  cancelAll(): void {
    this.active?.cancel();
    this.fallback?.cancelAll();
    for (const el of this.elements) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    for (const p of this.clips.values()) void p.then((c) => c && URL.revokeObjectURL(c.url));
    this.clips.clear();
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = undefined;
  }
}

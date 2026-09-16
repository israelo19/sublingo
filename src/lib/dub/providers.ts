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
  audio: HTMLAudioElement;
  url: string;
  duration: number;
}

const CLIP_WAIT_MS = 900;

/** Azure neural voice, synthesized in the background worker and cached there; browser voice fills in when a clip is late. */
export class AzureVoiceProvider implements DubVoiceProvider {
  readonly name = 'azure' as const;
  private readonly clips = new Map<string, Promise<Clip | undefined>>();
  private active?: ClipHandle;

  constructor(
    private readonly lang: string,
    private readonly fallback: BrowserVoiceProvider | undefined,
    private readonly onStatus: (message: string) => void,
  ) {}

  private key(cue: Cue) {
    return `${cue.start.toFixed(2)}|${cue.text}`;
  }

  prepare(cue: Cue): void {
    const k = this.key(cue);
    if (this.clips.has(k)) return;
    const p = this.fetchClip(cue).catch((err) => {
      this.onStatus(err instanceof Error ? err.message : String(err));
      return undefined;
    });
    this.clips.set(k, p);
    if (this.clips.size > 80) {
      const oldest = this.clips.keys().next().value as string;
      void this.clips.get(oldest)?.then((c) => c && URL.revokeObjectURL(c.url));
      this.clips.delete(oldest);
    }
  }

  private async fetchClip(cue: Cue): Promise<Clip | undefined> {
    const res = (await browser.runtime.sendMessage({ type: 'tts-azure', text: cue.text, lang: this.lang })) as AzureTtsResponse;
    if ('error' in res) throw new Error(res.error);
    const bytes = Uint8Array.from(atob(res.audio), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: res.mime }));
    const audio = new Audio(url);
    audio.preload = 'auto';
    const duration = await new Promise<number>((resolve) => {
      audio.addEventListener('loadedmetadata', () => resolve(audio.duration), { once: true });
      audio.addEventListener('error', () => resolve(0), { once: true });
    });
    return { audio, url, duration: Number.isFinite(duration) ? duration : 0 };
  }

  private readyClip(cue: Cue): Promise<Clip | undefined> {
    this.prepare(cue);
    return Promise.race([this.clips.get(this.key(cue))!, new Promise<undefined>((r) => setTimeout(() => r(undefined), CLIP_WAIT_MS))]);
  }

  async durationOf(cue: Cue): Promise<number | undefined> {
    const clip = await this.readyClip(cue);
    return clip && clip.duration > 0 ? clip.duration : undefined;
  }

  async speak(cue: Cue, index: number, speechRate: number): Promise<ClipHandle | undefined> {
    const clip = await this.readyClip(cue);
    if (!clip) {
      if (this.fallback) {
        this.onStatus('Azure clip not ready, using the browser voice for this line');
        return this.fallback.speak(cue, index, speechRate);
      }
      return undefined;
    }
    const audio = clip.audio;
    audio.playbackRate = speechRate;
    audio.currentTime = 0;
    let settle: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => (settle = resolve));
    audio.onended = () => settle();
    audio.onerror = () => settle();
    try {
      await audio.play();
    } catch (err) {
      this.onStatus(err instanceof Error && err.name === 'NotAllowedError' ? 'Click the video once to allow dubbed audio' : String(err));
      settle();
      return undefined;
    }
    const handle: ClipHandle = {
      done: finished.then(() => ({ actualSec: clip.duration / speechRate })),
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

  cancelAll(): void {
    this.active?.cancel();
    this.fallback?.cancelAll();
  }
}

import { browser } from '#imports';
import type { AzureTtsResponse } from '@/lib/messages';
import type { Cue } from '@/lib/subtitles/types';
import { estimateSpeechSeconds, pickBrowserVoice, speakBrowser } from '@/lib/tts/browser';
import { MAX_RATE, type ClipHandle, type DubVoiceProvider } from './engine';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Free, offline voice from the operating system through speechSynthesis. */
export class BrowserVoiceProvider implements DubVoiceProvider {
  readonly name = 'browser' as const;
  private voice?: SpeechSynthesisVoice;
  private ready: Promise<void>;
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

  async speak(cue: Cue, _index: number, windowSec: number, onFit: (fit: { rate: number; overflowSec: number }) => void): Promise<ClipHandle | undefined> {
    await this.ready;
    if (!globalThis.speechSynthesis) return undefined;
    const natural = estimateSpeechSeconds(cue.text);
    const rate = clamp(natural / windowSec, 1, MAX_RATE);
    onFit({ rate, overflowSec: natural / rate - windowSec });
    const h = speakBrowser(cue.text, { lang: this.lang, voice: this.voice, rate });
    this.active = h;
    const done = h.done.then((result) => {
      if (result === 'error') this.onBlocked?.();
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

/** Azure neural voice, synthesized in the background worker and cached there; browser voice fills in when a clip is late. */
export class AzureVoiceProvider implements DubVoiceProvider {
  readonly name = 'azure' as const;
  private readonly clips = new Map<string, Promise<Clip | undefined>>();
  private readonly fallback?: BrowserVoiceProvider;
  private active?: ClipHandle;

  constructor(
    private readonly lang: string,
    fallback: BrowserVoiceProvider | undefined,
    private readonly onStatus: (message: string) => void,
  ) {
    this.fallback = fallback;
  }

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
    if (this.clips.size > 60) this.clips.delete(this.clips.keys().next().value as string);
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

  async speak(cue: Cue, index: number, windowSec: number, onFit: (fit: { rate: number; overflowSec: number }) => void): Promise<ClipHandle | undefined> {
    this.prepare(cue);
    // Give a not-yet-ready clip a moment, then fall back to the browser voice for this line.
    const clip = await Promise.race([this.clips.get(this.key(cue))!, new Promise<undefined>((r) => setTimeout(() => r(undefined), 700))]);
    if (!clip) {
      if (this.fallback) {
        this.onStatus('Azure clip not ready, using browser voice for this line');
        return this.fallback.speak(cue, index, windowSec, onFit);
      }
      return undefined;
    }
    const rate = clip.duration > 0 ? clamp(clip.duration / windowSec, 1, MAX_RATE) : 1;
    onFit({ rate, overflowSec: clip.duration > 0 ? clip.duration / rate - windowSec : 0 });
    const audio = clip.audio;
    audio.playbackRate = rate;
    audio.currentTime = 0;
    let settle: () => void = () => undefined;
    const done = new Promise<void>((resolve) => (settle = resolve));
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
      done,
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

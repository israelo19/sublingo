import { baseLang } from '@/lib/subtitles/types';
/** Web Speech API (speechSynthesis) voice: free, offline, always available as a fallback. */

const QUALITY_HINTS = [/premium/i, /enhanced/i, /siri/i, /natural/i, /neural/i, /google/i];

export function loadVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  const synth = globalThis.speechSynthesis;
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(synth.getVoices()), timeoutMs);
    synth.addEventListener(
      'voiceschanged',
      () => {
        clearTimeout(timer);
        resolve(synth.getVoices());
      },
      { once: true },
    );
  });
}

export function rankVoices(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice[] {
  const base = baseLang(lang);
  const score = (v: SpeechSynthesisVoice) => {
    let s = 0;
    QUALITY_HINTS.forEach((re, i) => {
      if (re.test(v.name)) s -= 10 - i;
    });
    if (v.localService) s -= 1; // offline voices start instantly
    if (v.default) s -= 0.5;
    return s;
  };
  return voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(base)).sort((a, b) => score(a) - score(b));
}

export async function pickBrowserVoice(lang: string, preferredName?: string): Promise<SpeechSynthesisVoice | undefined> {
  const voices = await loadVoices();
  if (preferredName) {
    const exact = voices.find((v) => v.name === preferredName);
    if (exact) return exact;
  }
  return rankVoices(voices, lang)[0];
}

export interface SpeechHandle {
  done: Promise<'ended' | 'cancelled' | 'error'>;
  cancel(): void;
  pause(): void;
  resume(): void;
}

export function speakBrowser(text: string, o: { lang: string; voice?: SpeechSynthesisVoice; rate?: number; volume?: number }): SpeechHandle {
  const synth = globalThis.speechSynthesis;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = o.voice?.lang ?? o.lang;
  if (o.voice) utter.voice = o.voice;
  utter.rate = Math.min(2, Math.max(0.5, o.rate ?? 1));
  utter.volume = o.volume ?? 1;
  let settle: (v: 'ended' | 'cancelled' | 'error') => void = () => undefined;
  const done = new Promise<'ended' | 'cancelled' | 'error'>((resolve) => (settle = resolve));
  let cancelled = false;
  utter.onend = () => settle(cancelled ? 'cancelled' : 'ended');
  utter.onerror = (e) => settle(e.error === 'interrupted' || e.error === 'canceled' ? 'cancelled' : 'error');
  if (!synth) {
    settle('error');
  } else {
    synth.cancel();
    synth.speak(utter);
  }
  return {
    done,
    cancel: () => {
      cancelled = true;
      synth?.cancel();
      settle('cancelled');
    },
    pause: () => synth?.pause(),
    resume: () => synth?.resume(),
  };
}

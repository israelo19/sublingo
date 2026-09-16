import type { PlayerAdapter } from './types';

/** Adapter for any page that plays through a plain HTML5 <video> element (YouTube included). */
export function createHtml5Adapter(video: HTMLVideoElement, intervalMs = 100): PlayerAdapter {
  const listeners = new Set<(t: number, paused: boolean) => void>();
  const emit = () => {
    for (const cb of listeners) cb(video.currentTime, video.paused);
  };
  const timer = window.setInterval(() => {
    if (!video.paused) emit();
  }, intervalMs);
  const events = ['play', 'pause', 'seeked', 'timeupdate', 'ratechange'] as const;
  for (const ev of events) video.addEventListener(ev, emit);

  return {
    currentTime: () => video.currentTime,
    paused: () => video.paused,
    seek: (s) => {
      video.currentTime = Math.max(0, s);
    },
    play: () => {
      void video.play().catch(() => undefined);
    },
    pause: () => video.pause(),
    onTime: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy: () => {
      window.clearInterval(timer);
      for (const ev of events) video.removeEventListener(ev, emit);
      listeners.clear();
    },
  };
}

import type { PlayerAdapter } from './types';

/**
 * Adapter for pages that play through an HTML5 <video> element (YouTube included).
 *
 * The element is re-resolved on every tick instead of being captured once: YouTube swaps
 * its <video> around ads and preloaded videos, and a stale reference keeps reporting the
 * old element's frozen currentTime while the real video plays on.
 */
export function createHtml5Adapter(resolve: () => HTMLVideoElement | null, intervalMs = 100): PlayerAdapter {
  const listeners = new Set<(t: number, paused: boolean) => void>();
  const events = ['play', 'pause', 'seeked', 'timeupdate', 'ratechange', 'ended', 'loadedmetadata'] as const;
  let current: HTMLVideoElement | null = null;
  let lastTime = -1;
  let lastPaused: boolean | undefined;

  const emit = () => {
    const v = current;
    if (!v) return;
    const t = v.currentTime;
    const paused = v.paused;
    if (t === lastTime && paused === lastPaused) return;
    lastTime = t;
    lastPaused = paused;
    for (const cb of listeners) cb(t, paused);
  };

  const bind = (next: HTMLVideoElement | null) => {
    if (next === current) return;
    if (current) for (const ev of events) current.removeEventListener(ev, emit);
    current = next;
    lastTime = -1;
    lastPaused = undefined;
    if (current) {
      for (const ev of events) current.addEventListener(ev, emit);
      emit();
    }
  };

  bind(resolve());
  const timer = window.setInterval(() => {
    const next = resolve();
    if (next !== current) bind(next);
    else emit();
  }, intervalMs);

  return {
    currentTime: () => current?.currentTime ?? 0,
    paused: () => current?.paused ?? true,
    seek: (s) => {
      if (current) current.currentTime = Math.max(0, s);
    },
    play: () => {
      void current?.play().catch(() => undefined);
    },
    pause: () => current?.pause(),
    onTime: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy: () => {
      window.clearInterval(timer);
      bind(null);
      listeners.clear();
    },
  };
}

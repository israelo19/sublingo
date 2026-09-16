import type { Cue } from './types';

/** Index of the last cue whose start <= t, or -1. Cues must be sorted by start. */
export function indexAtOrBefore(cues: Cue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * Index of the cue active at time t. `sticky` extends each cue's end by that
 * many seconds so short gaps between lines don't flicker the caption off.
 */
export function activeIndex(cues: Cue[], t: number, sticky = 0): number {
  const i = indexAtOrBefore(cues, t);
  if (i < 0) return -1;
  return t < cues[i].end + sticky ? i : -1;
}

/** Cues overlapping the window [start, end). */
export function overlapping(cues: Cue[], start: number, end: number): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    if (c.start >= end) break;
    if (c.end > start) out.push(c);
  }
  return out;
}

/** Index of the cue to jump to for "previous line" from time t. */
export function previousIndex(cues: Cue[], t: number, tolerance = 0.8): number {
  const i = indexAtOrBefore(cues, t);
  if (i < 0) return -1;
  // If we're just after the start of the current cue, go one further back.
  return t - cues[i].start < tolerance ? Math.max(0, i - 1) : i;
}

/** Index of the cue to jump to for "next line" from time t, or -1 at the end. */
export function nextIndex(cues: Cue[], t: number): number {
  const i = indexAtOrBefore(cues, t);
  return i + 1 < cues.length ? i + 1 : -1;
}

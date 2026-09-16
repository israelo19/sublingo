import type { Cue } from './types';

interface Json3Seg {
  utf8?: string;
  tOffsetMs?: number;
}

interface Json3Event {
  tStartMs: number;
  dDurationMs?: number;
  segs?: Json3Seg[];
  aAppend?: number;
}

/**
 * Parse YouTube's `fmt=json3` timed-text payload into cues.
 * Auto-generated (ASR) tracks emit rolling "append" events and window
 * definitions without text; both are skipped. Overlapping cues are clamped so
 * only one primary cue is active at a time.
 */
export function parseJson3(text: string): Cue[] {
  let data: { events?: Json3Event[] };
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }

  const cues: Cue[] = [];
  for (const ev of data.events ?? []) {
    if (!ev.segs || ev.aAppend === 1 || typeof ev.tStartMs !== 'number') continue;
    const text = ev.segs
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const start = ev.tStartMs / 1000;
    const durationMs = ev.dDurationMs && ev.dDurationMs > 0 ? ev.dDurationMs : 2000;
    cues.push({ start, end: start + durationMs / 1000, text });
  }

  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length - 1; i++) {
    if (cues[i].end > cues[i + 1].start && cues[i + 1].start > cues[i].start) {
      cues[i].end = cues[i + 1].start;
    }
  }
  return cues;
}

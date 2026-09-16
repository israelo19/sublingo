import { describe, expect, it } from 'vitest';
import { parseJson3 } from './json3';

const fixture = JSON.stringify({
  wireMagic: 'pb3',
  events: [
    { tStartMs: 0, dDurationMs: 1000, id: 1, wpWinPosId: 1, wsWinStyleId: 1 },
    { tStartMs: 500, dDurationMs: 2000, wWinId: 1, segs: [{ utf8: 'Bonjour' }, { utf8: ' à tous', tOffsetMs: 400 }] },
    { tStartMs: 2500, dDurationMs: 1500, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
    { tStartMs: 3000, dDurationMs: 3000, wWinId: 1, segs: [{ utf8: 'Comment ça va ?' }] },
    { tStartMs: 5000, dDurationMs: 2000, wWinId: 1, segs: [{ utf8: 'Très bien.' }] },
  ],
});

describe('parseJson3', () => {
  it('extracts text cues and skips windows and append events', () => {
    const cues = parseJson3(fixture);
    expect(cues.map((c) => c.text)).toEqual(['Bonjour à tous', 'Comment ça va ?', 'Très bien.']);
    expect(cues[0]).toMatchObject({ start: 0.5, end: 2.5 });
  });

  it('clamps a cue that overlaps the next one', () => {
    const cues = parseJson3(fixture);
    expect(cues[1].end).toBe(5);
  });

  it('returns [] for garbage', () => {
    expect(parseJson3('not json')).toEqual([]);
  });
});

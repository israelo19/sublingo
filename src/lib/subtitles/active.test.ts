import { describe, expect, it } from 'vitest';
import { activeIndex, nextIndex, overlapping, previousIndex } from './active';

const cues = [
  { start: 1, end: 2, text: 'a' },
  { start: 3, end: 4, text: 'b' },
  { start: 5, end: 6, text: 'c' },
];

describe('activeIndex', () => {
  it('finds the active cue', () => {
    expect(activeIndex(cues, 1.5)).toBe(0);
    expect(activeIndex(cues, 3.99)).toBe(1);
  });
  it('returns -1 in gaps unless sticky covers them', () => {
    expect(activeIndex(cues, 2.5)).toBe(-1);
    expect(activeIndex(cues, 2.5, 1)).toBe(0);
    expect(activeIndex(cues, 0.5)).toBe(-1);
  });
});

describe('navigation', () => {
  it('previous goes to the start of the current cue unless already there', () => {
    expect(previousIndex(cues, 3.9)).toBe(1);
    expect(previousIndex(cues, 3.1)).toBe(0);
    expect(previousIndex(cues, 1.1)).toBe(0);
  });
  it('next finds the following cue', () => {
    expect(nextIndex(cues, 1.5)).toBe(1);
    expect(nextIndex(cues, 5.5)).toBe(-1);
    expect(nextIndex(cues, 0)).toBe(0);
  });
});

describe('overlapping', () => {
  it('returns cues intersecting the window', () => {
    expect(overlapping(cues, 1.5, 3.5).map((c) => c.text)).toEqual(['a', 'b']);
    expect(overlapping(cues, 2, 3)).toEqual([]);
  });
});

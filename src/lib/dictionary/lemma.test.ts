import { describe, expect, it } from 'vitest';
import { detectLemma } from './lemma';

describe('detectLemma', () => {
  it('detects verb forms', () => {
    expect(detectLemma('third-person singular imperfect indicative of manger')).toBe('manger');
    expect(detectLemma('inflection of manger:')).toBe('manger');
    expect(detectLemma('past participle of manger')).toBe('manger');
  });
  it('detects adjective and noun forms', () => {
    expect(detectLemma('feminine plural of grand')).toBe('grand');
    expect(detectLemma('plural of chat')).toBe('chat');
    expect(detectLemma("Alternative form of aujourd'hui")).toBe("aujourd'hui");
  });
  it('ignores ordinary definitions that contain "of"', () => {
    expect(detectLemma('a piece of cake')).toBeUndefined();
    expect(detectLemma('to eat')).toBeUndefined();
    expect(detectLemma('a form of government')).toBeUndefined();
  });
  it('falls back to the last "of X" when tagged form-of', () => {
    expect(detectLemma('something unusual of manger', true)).toBe('manger');
  });
});

import { describe, expect, it } from 'vitest';
import { sourceUrl, toCsv, type VocabEntry } from './vocab-model';

const entry: VocabEntry = {
  id: '1',
  word: 'apprenez',
  lemma: 'apprendre',
  lang: 'fr',
  sentence: 'Apprenez le français, "vite" !',
  translation: 'Learn French, "fast"!',
  definition: 'to learn',
  site: 'youtube',
  videoId: 'abc123',
  title: 'RFI',
  time: 12.7,
  savedAt: Date.UTC(2026, 8, 15),
};

describe('toCsv', () => {
  it('quotes cells containing commas or quotes and links back to the video', () => {
    const csv = toCsv([entry]);
    const [header, row] = csv.trim().split('\r\n');
    expect(header.startsWith('word,lemma,ipa,lang,definition,sentence')).toBe(true);
    expect(row).toContain('"Apprenez le français, ""vite"" !"');
    expect(row).toContain('https://www.youtube.com/watch?v=abc123&t=12s');
    expect(row).toContain('2026-09-15T00:00:00.000Z');
  });
});

describe('sourceUrl', () => {
  it('returns empty for unknown sites', () => {
    expect(sourceUrl({ site: 'other', videoId: 'x', time: 1 })).toBe('');
  });
});

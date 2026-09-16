import { describe, expect, it } from 'vitest';
import { buildNote, markWord } from './notes';

describe('markWord', () => {
  it('bolds the first case-insensitive match and escapes HTML', () => {
    expect(markWord('Apprenez <le> français', 'apprenez')).toBe('<b>Apprenez</b> &lt;le&gt; français');
  });
  it('leaves the sentence alone when the word is absent', () => {
    expect(markWord('Bonjour', 'chat')).toBe('Bonjour');
  });
});

describe('buildNote', () => {
  it('fills every field and links to the video timestamp', () => {
    const note = buildNote(
      {
        id: '1', word: 'apprenez', lemma: 'apprendre', ipa: '/a.pʁɑ̃dʁ/', lang: 'fr', sentence: 'Apprenez vite', translation: 'Learn fast',
        definition: 'to learn', site: 'youtube', videoId: 'abc', title: 'RFI & co', time: 61, savedAt: 0,
      },
      'Sublingo', 'Sublingo',
    );
    expect(note.fields.Word).toBe('apprenez');
    expect(note.fields.Lemma).toBe('apprendre');
    expect(note.fields.Sentence).toBe('<b>Apprenez</b> vite');
    expect(note.fields.Source).toBe('<a href="https://www.youtube.com/watch?v=abc&t=61s">RFI &amp; co</a>');
    expect(note.tags).toContain('lang::fr');
  });
});

import { describe, expect, it } from 'vitest';
import { isSpeakable, speakableText } from './speakable';

describe('isSpeakable', () => {
  it('rejects sound descriptions and music markers', () => {
    expect(isSpeakable('[musique]')).toBe(false);
    expect(isSpeakable('[Applaudissements] [rires]')).toBe(false);
    expect(isSpeakable('(rires)')).toBe(false);
    expect(isSpeakable('♪ ♪')).toBe(false);
    expect(isSpeakable('')).toBe(false);
  });
  it('accepts speech, including lines that mix speech and a tag', () => {
    expect(isSpeakable('Bonjour à tous.')).toBe(true);
    expect(isSpeakable('[musique] Bonjour à tous.')).toBe(true);
  });
});

describe('speakableText', () => {
  it('strips tags and notes but keeps the words', () => {
    expect(speakableText('♪ [musique] Oui. » CERTAINEMENT. (rires)')).toBe('Oui. » CERTAINEMENT.');
  });
});

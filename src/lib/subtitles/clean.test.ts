import { describe, expect, it } from 'vitest';
import { applyGroups, cleanCaptionText, isSpeakerChange, mergeFragments, mergeGroups, stripSpeakerLabel } from './clean';

describe('cleanCaptionText', () => {
  it('removes speaker-change markers and entities', () => {
    expect(cleanCaptionText('>> Well, 3D a lot of that mindset was')).toBe('Well, 3D a lot of that mindset was');
    expect(cleanCaptionText('&gt;&gt; Nurse. I I should say')).toBe('Nurse. I I should say');
    expect(cleanCaptionText('- Salut.')).toBe('Salut.');
  });
  it('keeps two-speaker dash lines intact', () => {
    expect(cleanCaptionText('- Salut. - Bonjour.')).toBe('- Salut. - Bonjour.');
  });
});

describe('stripSpeakerLabel', () => {
  it('drops the speaker name but keeps the words', () => {
    expect(stripSpeakerLabel('MABEL: What are you doing?')).toBe('What are you doing?');
    expect(stripSpeakerLabel('Mabel: what?')).toBe('what?');
    expect(stripSpeakerLabel('Dr. Smith: sit down.')).toBe('sit down.');
  });
  it('leaves ordinary sentences alone', () => {
    expect(stripSpeakerLabel('Il est 17h: on commence.')).toBe('Il est 17h: on commence.');
    expect(stripSpeakerLabel('MABEL')).toBe('MABEL');
  });
});

describe('mergeFragments', () => {
  const cues = [
    { start: 0, end: 1, text: 'Nurse. I should say on' },
    { start: 1.1, end: 2, text: 'Van Ble has the ball' },
    { start: 2.1, end: 3, text: 'and scores.' },
    { start: 3.2, end: 4, text: '>> Wow.' },
    { start: 10, end: 11, text: 'Later,' },
    { start: 11.2, end: 12, text: 'much later.' },
  ];
  it('joins mid-sentence fragments and stops at sentence ends, speaker changes, and long gaps', () => {
    expect(mergeGroups(cues)).toEqual([[0, 1, 2], [3], [4, 5]]);
    const merged = mergeFragments(cues);
    expect(merged[0]).toEqual({ start: 0, end: 3, text: 'Nurse. I should say on Van Ble has the ball and scores.' });
    expect(merged[1].text).toBe('Wow.');
  });
  it('respects the character limit', () => {
    const long = [
      { start: 0, end: 1, text: 'a'.repeat(60) },
      { start: 1, end: 2, text: 'b'.repeat(60) },
    ];
    expect(mergeGroups(long)).toEqual([[0], [1]]);
  });
  it('applies the same groups to a parallel (translated) track', () => {
    const translated = cues.map((c) => ({ ...c, text: `FR(${c.text})` }));
    const out = applyGroups(translated, mergeGroups(cues));
    expect(out).toHaveLength(3);
    expect(out[0].text).toBe('FR(Nurse. I should say on) FR(Van Ble has the ball) FR(and scores.)');
  });
  it('detects speaker changes', () => {
    expect(isSpeakerChange('>> Hi')).toBe(true);
    expect(isSpeakerChange('MABEL: hi')).toBe(true);
    expect(isSpeakerChange('hello there')).toBe(false);
  });
});

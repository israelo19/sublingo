import { describe, expect, it } from 'vitest';
import { SpeechCalibrator, planCue, shouldDuck } from './plan';

describe('planCue', () => {
  it('leaves everything alone when the clip fits', () => {
    expect(planCue(2, 3, true)).toEqual({ speechRate: 1, videoRate: 1 });
  });
  it('slows the video instead of rushing the voice', () => {
    const p = planCue(3, 2, true);
    expect(p.speechRate).toBeLessThanOrEqual(1.1);
    // 3 s of speech at 1.05x = 2.86 s; window 2 s / videoRate must equal that.
    expect(2 / p.videoRate).toBeCloseTo(3 / p.speechRate, 1);
  });
  it('caps the slowdown and speeds speech within reason when video must stay fixed', () => {
    expect(planCue(10, 2, true).videoRate).toBe(0.7);
    expect(planCue(3, 2, false)).toEqual({ speechRate: 1.3, videoRate: 1 });
  });
});

describe('shouldDuck', () => {
  const cues = [
    { start: 1, end: 2, text: 'Bonjour' },
    { start: 2.5, end: 3.5, text: '[musique]' },
    { start: 6, end: 7, text: 'Salut' },
  ];
  it('ducks during and just before speech, not during long gaps or sound tags', () => {
    expect(shouldDuck(cues, 1.5, false)).toBe(true);
    expect(shouldDuck(cues, 0.2, false)).toBe(true); // Bonjour starts within 1.2 s
    expect(shouldDuck(cues, 3, false)).toBe(false); // only [musique] is active
    expect(shouldDuck(cues, 4, false)).toBe(false); // gap
    expect(shouldDuck(cues, 5, false)).toBe(true); // Salut imminent
    expect(shouldDuck(cues, 4, true)).toBe(true); // still speaking
  });
});

describe('SpeechCalibrator', () => {
  it('moves its estimate toward measurements', () => {
    const c = new SpeechCalibrator(16);
    const text = 'Bonjour à toutes et à tous, bienvenue.'; // 38 chars
    expect(c.estimate(text)).toBeCloseTo(38 / 16, 2);
    c.observe(text, 38 / 22); // this voice is faster: 22 cps
    expect(c.charsPerSecond).toBeGreaterThan(16);
    expect(c.charsPerSecond).toBeLessThan(22);
  });
});

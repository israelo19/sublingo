import { indexAtOrBefore } from '@/lib/subtitles/active';
import type { Cue } from '@/lib/subtitles/types';
import { isSpeakable } from './speakable';

export interface CuePlan {
  /** Playback rate for the spoken clip (1 = natural). */
  speechRate: number;
  /** Multiplier applied to the video's playback rate while this line plays (1 = unchanged). */
  videoRate: number;
}

export interface PlanLimits {
  /** Fastest the voice may go when the video is allowed to slow down. Barely audible. */
  maxSpeechRate: number;
  /** Fastest the voice may go when the video must keep its speed. */
  maxSpeechRateFixedVideo: number;
  minVideoRate: number;
}

export const DEFAULT_LIMITS: PlanLimits = { maxSpeechRate: 1.1, maxSpeechRateFixedVideo: 1.3, minVideoRate: 0.7 };

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Fit a clip of `durationSec` into a `windowSec` slot. Prefer slowing the video (the voice
 * stays natural) and only nudge the speech rate a little; without video slowdown, speed the
 * voice up within reason. Wall-clock slot after pacing = windowSec / videoRate.
 */
export function planCue(durationSec: number, windowSec: number, slowVideo: boolean, limits: PlanLimits = DEFAULT_LIMITS): CuePlan {
  if (!(durationSec > 0) || !(windowSec > 0) || durationSec <= windowSec) return { speechRate: 1, videoRate: 1 };
  const needed = durationSec / windowSec;
  if (!slowVideo) return { speechRate: round(Math.min(limits.maxSpeechRateFixedVideo, needed)), videoRate: 1 };
  const speechRate = Math.min(limits.maxSpeechRate, needed);
  const videoRate = Math.max(limits.minVideoRate, speechRate / needed);
  return { speechRate: round(speechRate), videoRate: round(videoRate) };
}

/**
 * Keep the original audio ducked while a line is being spoken, while a speakable line is
 * active, or when the next speakable line starts within `lookaheadSec`. Otherwise (music,
 * long pauses) let it back up.
 */
export function shouldDuck(cues: Cue[], t: number, speaking: boolean, lookaheadSec = 1.2): boolean {
  if (speaking) return true;
  const i = indexAtOrBefore(cues, t);
  if (i >= 0 && t < cues[i].end && isSpeakable(cues[i].text)) return true;
  for (let j = i + 1; j < cues.length && cues[j].start - t <= lookaheadSec; j++) {
    if (isSpeakable(cues[j].text)) return true;
  }
  return false;
}

/** Learns how many characters per second a voice really speaks, from measured utterances. */
export class SpeechCalibrator {
  private cps: number;
  constructor(
    initialCharsPerSecond = 16,
    private readonly alpha = 0.3,
  ) {
    this.cps = initialCharsPerSecond;
  }

  estimate(text: string): number {
    return Math.max(0.5, text.trim().length / this.cps);
  }

  /** `naturalSec` = measured seconds at rate 1 (divide measured time by the rate used). */
  observe(text: string, naturalSec: number): void {
    const chars = text.trim().length;
    if (chars < 8 || !(naturalSec > 0.3)) return;
    const measured = Math.min(25, Math.max(6, chars / naturalSec));
    this.cps = this.cps * (1 - this.alpha) + measured * this.alpha;
  }

  get charsPerSecond(): number {
    return this.cps;
  }
}

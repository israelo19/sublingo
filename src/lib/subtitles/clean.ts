import type { Cue } from './types';

/**
 * Broadcast closed captions carry markup that regular subtitles do not: ">>" for a speaker
 * change, "NAME:" speaker labels, leading dashes, HTML entities, and lines that break in the
 * middle of a sentence. These helpers normalize that for display and speech.
 */

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

export const decodeEntities = (s: string): string => s.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m);

/** "MABEL:", "MABEL 2:", "Mabel:", "Dr. Smith:" at the start of a line. */
const SPEAKER_LABEL = /^\s*(?:[A-Z][A-Z0-9'’.\- ]{0,30}|[A-Z][\p{Ll}'’.\-]+(?:\s[A-Z][\p{Ll}'’.\-]+){0,2})\s*:(?:\s+(?=\S)|\s*$)/u;
const SPEAKER_CHANGE_MARK = /^\s*(?:>>+|»)/;
const LEADING_DASH = /^\s*[-–—]\s+/;

export const isSpeakerChange = (raw: string): boolean => SPEAKER_CHANGE_MARK.test(raw) || LEADING_DASH.test(raw) || SPEAKER_LABEL.test(raw);

/** Display cleanup: drop ">>" markers and a single leading dash, decode entities, tidy spaces. */
export function cleanCaptionText(text: string): string {
  let t = decodeEntities(text);
  t = t.replace(/\s*>>+\s*/g, ' ');
  // A single leading dash is a speaker marker; two dashes in one line mean two speakers, keep those.
  if (LEADING_DASH.test(t) && !/\s[-–—]\s/.test(t.replace(LEADING_DASH, ''))) t = t.replace(LEADING_DASH, '');
  return t.replace(/\s+/g, ' ').trim();
}

/** Speech cleanup: also remove a leading "NAME:" speaker label, which is read but never spoken. */
export function stripSpeakerLabel(text: string): string {
  return text.replace(SPEAKER_LABEL, '').trim();
}

export interface MergeOptions {
  /** Longest merged line, in characters. */
  maxChars: number;
  /** Largest silence between two fragments that still belong together, in seconds. */
  maxGap: number;
  /** Longest merged span, in seconds. */
  maxDuration: number;
}

export const DEFAULT_MERGE: MergeOptions = { maxChars: 100, maxGap: 0.6, maxDuration: 7 };

const ENDS_SENTENCE = /[.!?…][)"”»]?\s*$/;

/**
 * Group consecutive fragments into sentence-sized cues: a cue that does not end a sentence
 * joins the next one while the gap is short, no speaker change occurs, and the result stays
 * under the length and duration limits. Returns groups of source indices.
 */
export function mergeGroups(cues: Cue[], o: MergeOptions = DEFAULT_MERGE): number[][] {
  const groups: number[][] = [];
  let i = 0;
  while (i < cues.length) {
    const group = [i];
    let text = cleanCaptionText(cues[i].text);
    const start = cues[i].start;
    let end = cues[i].end;
    let j = i + 1;
    while (j < cues.length) {
      const next = cues[j];
      if (ENDS_SENTENCE.test(text) || isSpeakerChange(next.text)) break;
      if (next.start - end > o.maxGap || next.end - start > o.maxDuration) break;
      const candidate = `${text} ${cleanCaptionText(next.text)}`;
      if (candidate.length > o.maxChars) break;
      text = candidate;
      end = next.end;
      group.push(j);
      j++;
    }
    groups.push(group);
    i = j;
  }
  return groups;
}

/** Build merged cues from groups of indices, cleaning the text. */
export function applyGroups(cues: Cue[], groups: number[][]): Cue[] {
  return groups
    .filter((g) => g.length > 0 && g[0] < cues.length)
    .map((g) => {
      const members = g.filter((k) => k < cues.length).map((k) => cues[k]);
      return {
        start: members[0].start,
        end: members[members.length - 1].end,
        text: cleanCaptionText(members.map((c) => c.text).join(' ')),
      };
    });
}

export const mergeFragments = (cues: Cue[], o: MergeOptions = DEFAULT_MERGE): Cue[] => applyGroups(cues, mergeGroups(cues, o));

export const cleanCues = (cues: Cue[]): Cue[] => cues.map((c) => ({ ...c, text: cleanCaptionText(c.text) })).filter((c) => c.text);

/**
 * Caption lines that describe sound rather than speech ("[musique]", "(rires)", "♪ ... ♪",
 * "[Applaudissements]") must not be read aloud by the dub voice.
 */
import { cleanCaptionText, stripSpeakerLabel } from '@/lib/subtitles/clean';

const BRACKETED = /^[\s♪♫]*(?:[\[(（【][^\])）】]*[\])）】][\s,.!?…♪♫-]*)+$/u;
const MUSIC_ONLY = /^[\s♪♫]+$/u;

/** Strip speaker labels, ">>" markers, inline sound descriptions and music notes before speaking. */
export function speakableText(text: string): string {
  return stripSpeakerLabel(cleanCaptionText(text))
    .replace(/[\[(（【][^\])）】]*[\])）】]/gu, ' ')
    .replace(/[♪♫]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSpeakable(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (MUSIC_ONLY.test(t) || BRACKETED.test(t)) return false;
  return /[\p{L}\p{N}]/u.test(speakableText(t));
}

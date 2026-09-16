/**
 * Caption lines that describe sound rather than speech ("[musique]", "(rires)", "♪ ... ♪",
 * "[Applaudissements]") must not be read aloud by the dub voice.
 */
const BRACKETED = /^[\s♪♫]*(?:[\[(（【][^\])）】]*[\])）】][\s,.!?…♪♫-]*)+$/u;
const MUSIC_ONLY = /^[\s♪♫]+$/u;

export function isSpeakable(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (MUSIC_ONLY.test(t) || BRACKETED.test(t)) return false;
  return /[\p{L}\p{N}]/u.test(t);
}

/** Strip inline sound descriptions and music notes from a line before speaking it. */
export function speakableText(text: string): string {
  return text
    .replace(/[\[(（【][^\])）】]*[\])）】]/gu, ' ')
    .replace(/[♪♫]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

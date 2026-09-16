/**
 * Detect "form of" definitions such as
 *   "third-person singular imperfect indicative of manger"
 *   "feminine plural of grand"
 *   "inflection of manger:"
 *   "Alternative form of aujourd'hui"
 * and return the headword they point to.
 */
const FORM_OF_RE =
  /^(?:\([^)]*\)\s*)?(?:[\p{L}\p{N}-]+\s+){0,6}?(?:plural|singular|participle|indicative|subjunctive|imperative|conditional|infinitive|inflection|gerund|comparative|superlative|spelling|misspelling|abbreviation|contraction|elision|clipping|apocope|feminine|masculine|(?:alternative|alternate|obsolete|archaic|dated|rare|nonstandard|superseded|reflexive|short|long|combining|pre-verbal|elided|contracted|dialectal|regional|informal|colloquial|euphemistic|standard|initialism|acronym|apocopic)\s+form)\b[^.:;]*?\bof\s+([\p{L}\p{M}][\p{L}\p{M}'’-]*)/iu;

export function detectLemma(definition: string, taggedFormOf = false): string | undefined {
  const text = definition.replace(/\s+/g, ' ').trim();
  const m = text.match(FORM_OF_RE);
  if (m) return m[1].replace(/’/g, "'");
  if (taggedFormOf) {
    const last = text.match(/\bof\s+([\p{L}\p{M}][\p{L}\p{M}'’-]*)\s*[:.]?\s*$/u);
    if (last) return last[1].replace(/’/g, "'");
  }
  return undefined;
}

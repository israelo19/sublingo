export interface Token {
  /** Text exactly as displayed. */
  text: string;
  /** Normalized lookup key. Undefined for punctuation and whitespace. */
  word?: string;
}

const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+|-[\p{L}\p{M}\p{N}]+)*['’]?/gu;

// French elision: l'homme -> l' + homme. These prefixes are looked up on their own.
const ELISION_RE = /^(l|d|j|m|t|s|n|c|qu|jusqu|lorsqu|puisqu|quoiqu)(['’])(.+)$/iu;
const KEEP_WHOLE = new Set(["aujourd'hui", "quelqu'un", "quelqu'une", "presqu'île", "entr'acte", "prud'homme"]);

export const normalizeWord = (text: string): string =>
  text.replace(/’/g, "'").toLowerCase().replace(/^['-]+/, '').replace(/-+$/, '');

/** Split a caption line into clickable word tokens and inert punctuation/space tokens. */
export function tokenize(text: string, lang = 'fr'): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) tokens.push({ text: text.slice(last, idx) });
    pushWord(tokens, m[0], lang);
    last = idx + m[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last) });
  return tokens;
}

function pushWord(tokens: Token[], raw: string, lang: string) {
  const lower = raw.replace(/’/g, "'").toLowerCase();
  if (lang === 'fr' && !KEEP_WHOLE.has(lower)) {
    const m = raw.match(ELISION_RE);
    if (m) {
      tokens.push({ text: m[1] + m[2], word: normalizeWord(m[1] + "'") });
      pushWord(tokens, m[3], lang);
      return;
    }
  }
  // A trailing apostrophe that is not an elision is really punctuation.
  const trailing = raw.match(/^(.*?)(['’])$/u);
  if (trailing && !ELISION_RE.test(raw)) {
    tokens.push({ text: trailing[1], word: normalizeWord(trailing[1]) });
    tokens.push({ text: trailing[2] });
    return;
  }
  tokens.push({ text: raw, word: normalizeWord(raw) });
}

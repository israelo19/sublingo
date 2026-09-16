import { describe, expect, it } from 'vitest';
import { tokenize } from './tokenize';

const words = (s: string) => tokenize(s, 'fr').filter((t) => t.word).map((t) => t.text);

describe('tokenize (fr)', () => {
  it('splits elisions and keeps hyphenated words whole', () => {
    expect(words("L'homme qu'il a vu, c'est peut-être Jean-Pierre !")).toEqual([
      "L'", 'homme', "qu'", 'il', 'a', 'vu', "c'", 'est', 'peut-être', 'Jean-Pierre',
    ]);
  });
  it("keeps aujourd'hui whole and normalizes the lookup key", () => {
    const toks = tokenize("Aujourd’hui, ça va.", 'fr');
    expect(toks[0]).toEqual({ text: 'Aujourd’hui', word: "aujourd'hui" });
  });
  it('round-trips the original text', () => {
    const s = "Je n'ai pas   dit « non » !";
    expect(tokenize(s, 'fr').map((t) => t.text).join('')).toBe(s);
  });
  it('treats a trailing apostrophe as punctuation', () => {
    expect(words("dit 'bonjour' fort")).toEqual(['dit', 'bonjour', 'fort']);
  });
});

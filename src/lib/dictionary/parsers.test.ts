import { describe, expect, it } from 'vitest';
import { parseFreeDict } from './freedict';
import { parseWiktionaryRest } from './wiktionary';
import { candidates } from './lookup';

describe('parseFreeDict', () => {
  it('extracts POS, IPA, senses and lemma', () => {
    const parsed = parseFreeDict({
      word: 'mangeait',
      entries: [
        {
          language: { code: 'fr' },
          partOfSpeech: 'verb',
          pronunciations: [{ type: 'ipa', text: '/mɑ̃.ʒɛ/' }],
          senses: [{ definition: 'third-person singular imperfect indicative of manger', tags: ['form-of'] }],
        },
      ],
    });
    expect(parsed.lemma).toBe('manger');
    expect(parsed.entries[0]).toMatchObject({ partOfSpeech: 'verb', ipa: '/mɑ̃.ʒɛ/' });
  });
});

describe('parseWiktionaryRest', () => {
  it('reads the requested language section and strips HTML', () => {
    const parsed = parseWiktionaryRest(
      {
        en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'a trough' }] }],
        fr: [
          {
            partOfSpeech: 'Verb',
            language: 'French',
            definitions: [{ definition: '<span class="x">to <a href="/wiki/eat">eat</a></span>', parsedExamples: [{ example: 'Je <b>mange</b>.' }] }],
          },
        ],
      },
      'fr',
    );
    expect(parsed.entries).toEqual([{ partOfSpeech: 'Verb', senses: [{ definition: 'to eat', examples: ['Je mange.'] }] }]);
  });
});

describe('candidates', () => {
  it('tries the original, lowercase, and hyphen head', () => {
    expect(candidates('Dis-moi')).toEqual(['Dis-moi', 'dis-moi', 'dis']);
    expect(candidates("l'")).toEqual(["l'", 'l']);
  });
});

import { detectLemma } from './lemma';
import type { DictEntry } from './types';

export interface FreeDictResponse {
  word?: string;
  entries?: Array<{
    language?: { code?: string; name?: string };
    partOfSpeech?: string;
    pronunciations?: Array<{ type?: string; text?: string; tags?: string[] }>;
    forms?: Array<{ word?: string; tags?: string[] }>;
    senses?: Array<{ definition?: string; examples?: string[]; tags?: string[] }>;
  }>;
  source?: { url?: string; license?: { name?: string; url?: string } };
}

export const freeDictUrl = (word: string, lang: string): string =>
  `https://freedictionaryapi.com/api/v1/entries/${encodeURIComponent(lang)}/${encodeURIComponent(word)}`;

export function parseFreeDict(json: FreeDictResponse): { entries: DictEntry[]; lemma?: string } {
  const entries: DictEntry[] = [];
  let lemma: string | undefined;
  for (const e of json.entries ?? []) {
    const ipa = e.pronunciations?.find((p) => p.type === 'ipa' && p.text)?.text;
    const senses = (e.senses ?? [])
      .map((s) => ({
        definition: (s.definition ?? '').replace(/\s+/g, ' ').trim(),
        examples: s.examples?.filter(Boolean).slice(0, 2),
        formOf: s.tags?.includes('form-of') ?? false,
      }))
      .filter((s) => s.definition);
    for (const s of senses) {
      if (!lemma) lemma = detectLemma(s.definition, s.formOf);
    }
    if (senses.length === 0 && !ipa) continue;
    entries.push({
      partOfSpeech: e.partOfSpeech ?? '',
      ipa,
      senses: senses.map(({ definition, examples }) => ({ definition, examples })),
    });
  }
  return { entries, lemma };
}

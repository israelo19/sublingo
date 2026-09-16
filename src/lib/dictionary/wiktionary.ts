import { detectLemma } from './lemma';
import type { DictEntry } from './types';

export type WiktionaryRestResponse = Record<
  string,
  Array<{
    partOfSpeech?: string;
    language?: string;
    definitions?: Array<{
      definition?: string;
      parsedExamples?: Array<{ example?: string }>;
      examples?: string[];
    }>;
  }>
>;

export const wiktionaryUrl = (word: string): string =>
  `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word.replace(/ /g, '_'))}`;

export const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

export function parseWiktionaryRest(json: WiktionaryRestResponse, lang: string): { entries: DictEntry[]; lemma?: string } {
  const section = json[lang] ?? [];
  const entries: DictEntry[] = [];
  let lemma: string | undefined;
  for (const e of section) {
    const senses = (e.definitions ?? [])
      .map((d) => ({
        definition: stripHtml(d.definition ?? ''),
        examples: (d.parsedExamples?.map((x) => stripHtml(x.example ?? '')) ?? d.examples?.map(stripHtml) ?? [])
          .filter(Boolean)
          .slice(0, 2),
      }))
      .filter((s) => s.definition);
    for (const s of senses) {
      if (!lemma) lemma = detectLemma(s.definition);
    }
    if (senses.length) entries.push({ partOfSpeech: e.partOfSpeech ?? '', senses });
  }
  return { entries, lemma };
}

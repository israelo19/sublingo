export interface DictSense {
  definition: string;
  examples?: string[];
}

export interface DictEntry {
  partOfSpeech: string;
  ipa?: string;
  senses: DictSense[];
}

export interface DictResult {
  word: string;
  lang: string;
  entries: DictEntry[];
  /** Set when `word` is an inflected form of another headword. */
  lemma?: string;
  lemmaEntries?: DictEntry[];
  source: 'freedictionaryapi' | 'wiktionary' | 'none';
  sourceUrl?: string;
  notFound?: boolean;
}

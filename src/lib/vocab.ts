import { storage } from '#imports';

export interface VocabEntry {
  id: string;
  word: string;
  lemma?: string;
  lang: string;
  sentence: string;
  translation?: string;
  definition?: string;
  site: string;
  videoId: string;
  title: string;
  /** seconds into the video */
  time: number;
  savedAt: number;
}

export const vocabItem = storage.defineItem<VocabEntry[]>('local:vocab', { fallback: [] });

export async function saveVocab(entry: Omit<VocabEntry, 'id' | 'savedAt'>): Promise<VocabEntry> {
  const list = await vocabItem.getValue();
  const full: VocabEntry = { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, savedAt: Date.now() };
  await vocabItem.setValue([full, ...list]);
  return full;
}

import { storage } from '#imports';
import type { VocabEntry } from './vocab-model';

export * from './vocab-model';

export const vocabItem = storage.defineItem<VocabEntry[]>('local:vocab', { fallback: [] });

export async function saveVocab(entry: Omit<VocabEntry, 'id' | 'savedAt'>): Promise<VocabEntry> {
  const list = await vocabItem.getValue();
  const full: VocabEntry = { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, savedAt: Date.now() };
  await vocabItem.setValue([full, ...list]);
  return full;
}

export async function removeVocab(id: string): Promise<void> {
  const list = await vocabItem.getValue();
  await vocabItem.setValue(list.filter((e) => e.id !== id));
}

export async function updateVocab(patches: Record<string, Partial<VocabEntry>>): Promise<void> {
  const list = await vocabItem.getValue();
  await vocabItem.setValue(list.map((e) => (patches[e.id] ? { ...e, ...patches[e.id] } : e)));
}

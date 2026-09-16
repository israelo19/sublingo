import type { VocabEntry } from '@/lib/vocab-model';
import { ANKI_BACK, ANKI_CSS, ANKI_FIELDS, ANKI_FRONT, buildNote } from './notes';

export async function ankiInvoke<T>(url: string, action: string, params: object = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, version: 6, params }),
    });
  } catch {
    throw new Error('Could not reach Anki. Is Anki open with the AnkiConnect add-on installed?');
  }
  if (!res.ok) throw new Error(`AnkiConnect returned HTTP ${res.status}`);
  const json = (await res.json()) as { result: T; error: string | null };
  if (json.error) throw new Error(json.error);
  return json.result;
}

export async function ankiVersion(url: string): Promise<number> {
  return ankiInvoke<number>(url, 'version');
}

async function ensureModel(url: string, modelName: string): Promise<void> {
  const names = await ankiInvoke<string[]>(url, 'modelNames');
  if (names.includes(modelName)) return;
  await ankiInvoke(url, 'createModel', {
    modelName,
    inOrderFields: [...ANKI_FIELDS],
    css: ANKI_CSS,
    cardTemplates: [{ Name: 'Recognition', Front: ANKI_FRONT, Back: ANKI_BACK }],
  });
}

export interface AnkiExportResult {
  added: number;
  skipped: number;
  /** vocab entry id -> Anki note id */
  noteIds: Record<string, number>;
}

/** Add the given entries as notes. Duplicates (same Word in the deck) are skipped, not errors. */
export async function exportToAnki(url: string, deck: string, model: string, entries: VocabEntry[]): Promise<AnkiExportResult> {
  await ensureModel(url, model);
  await ankiInvoke(url, 'createDeck', { deck });
  const notes = entries.map((e) => buildNote(e, deck, model));
  const results = await ankiInvoke<Array<number | null>>(url, 'addNotes', { notes });
  const out: AnkiExportResult = { added: 0, skipped: 0, noteIds: {} };
  results.forEach((id, i) => {
    if (typeof id === 'number') {
      out.added++;
      out.noteIds[entries[i].id] = id;
    } else {
      out.skipped++;
    }
  });
  return out;
}

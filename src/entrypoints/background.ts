import { browser, defineBackground } from '#imports';
import { ankiVersion, exportToAnki } from '@/lib/anki/client';
import { lookupWord } from '@/lib/dictionary/lookup';
import type { DictResult } from '@/lib/dictionary/types';
import type { Message } from '@/lib/messages';
import { loadSettings } from '@/lib/settings';
import { updateVocab, vocabItem } from '@/lib/vocab';

const HIT_TTL_MS = 30 * 24 * 3600 * 1000;
const MISS_TTL_MS = 24 * 3600 * 1000;
const memory = new Map<string, DictResult>();

interface CachedLookup {
  ts: number;
  result: DictResult;
}

async function lookupWithCache(word: string, lang: string): Promise<DictResult> {
  const key = `dc:${lang}:${word.toLowerCase()}`;
  const inMemory = memory.get(key);
  if (inMemory) return inMemory;

  const stored = (await browser.storage.local.get(key))[key] as CachedLookup | undefined;
  if (stored) {
    const ttl = stored.result.notFound ? MISS_TTL_MS : HIT_TTL_MS;
    if (Date.now() - stored.ts < ttl) {
      memory.set(key, stored.result);
      return stored.result;
    }
  }

  const result = await lookupWord(word, lang);
  memory.set(key, result);
  await browser.storage.local.set({ [key]: { ts: Date.now(), result } satisfies CachedLookup });
  return result;
}

async function ankiExport(ids?: string[]) {
  const settings = await loadSettings();
  const all = await vocabItem.getValue();
  const wanted = all.filter((e) => !e.ankiNoteId && (!ids || ids.includes(e.id)));
  if (!wanted.length) return { added: 0, skipped: 0, noteIds: {} };
  const result = await exportToAnki(settings.ankiUrl, settings.ankiDeck, settings.ankiModel, wanted);
  const patches = Object.fromEntries(Object.entries(result.noteIds).map(([id, noteId]) => [id, { ankiNoteId: noteId }]));
  if (Object.keys(patches).length) await updateVocab(patches);
  return result;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    switch (message?.type) {
      case 'lookup':
        lookupWithCache(message.word, message.lang).then(sendResponse, (err: unknown) => sendResponse({ error: errorMessage(err) }));
        return true;
      case 'anki-export':
        ankiExport(message.ids).then(sendResponse, (err: unknown) => sendResponse({ error: errorMessage(err) }));
        return true;
      case 'anki-status':
        loadSettings()
          .then((s) => ankiVersion(s.ankiUrl))
          .then((version) => sendResponse({ version }), (err: unknown) => sendResponse({ error: errorMessage(err) }));
        return true;
      default:
        return false;
    }
  });
});

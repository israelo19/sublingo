import { browser, defineBackground } from '#imports';
import { lookupWord } from '@/lib/dictionary/lookup';
import type { DictResult } from '@/lib/dictionary/types';
import type { Message } from '@/lib/messages';

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

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    if (message?.type === 'lookup') {
      lookupWithCache(message.word, message.lang).then(sendResponse, (err: unknown) =>
        sendResponse({ error: err instanceof Error ? err.message : String(err) }),
      );
      return true;
    }
    return false;
  });
});

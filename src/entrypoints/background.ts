import { browser, defineBackground } from '#imports';
import { ankiVersion, exportToAnki } from '@/lib/anki/client';
import { lookupWord } from '@/lib/dictionary/lookup';
import type { DictResult } from '@/lib/dictionary/types';
import type { Message } from '@/lib/messages';
import { idbGet, idbSet } from '@/lib/idb';
import { loadSettings } from '@/lib/settings';
import { AZURE_F0_REQUESTS_PER_MINUTE, AzureError, RateLimiter, azureListVoices, azureSynthesize, effectiveAzureVoice, isValidAzureRegion, isValidAzureVoiceName, voicesForLanguage } from '@/lib/tts/azure';
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

// ---------- Azure text-to-speech (dub mode) ----------

const azureLimiter = new RateLimiter(AZURE_F0_REQUESTS_PER_MINUTE - 2, 60_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Azure calls run one at a time so concurrent prefetches cannot burst past the per-minute quota together. */
let azureQueue: Promise<unknown> = Promise.resolve();
const enqueueAzure = <T>(job: () => Promise<T>): Promise<T> => {
  const run = azureQueue.then(job, job);
  azureQueue = run.catch(() => undefined);
  return run;
};

function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

async function hashKey(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

interface CachedClip {
  audio: string;
  mime: string;
  ts: number;
}

async function azureTts(text: string, lang: string, voiceOverride?: string) {
  const s = await loadSettings();
  if (!s.azureKey.trim()) throw new Error('No Azure key configured. Add one in the Sublingo popup under Dub.');
  if (!isValidAzureRegion(s.azureRegion)) throw new Error(`Unknown Azure region "${s.azureRegion}".`);
  const voice = voiceOverride || effectiveAzureVoice(s.azureVoice, lang);
  if (!isValidAzureVoiceName(voice)) throw new Error(`Invalid Azure voice name "${voice}".`);
  const cacheKey = `azure:${voice}:${await hashKey(text.trim())}`;
  const cached = await idbGet<CachedClip>('tts', cacheKey).catch(() => undefined);
  if (cached) return { audio: cached.audio, mime: cached.mime, cached: true };

  return enqueueAzure(async () => {
    // Another queued request may have produced this very clip meanwhile.
    const again = await idbGet<CachedClip>('tts', cacheKey).catch(() => undefined);
    if (again) return { audio: again.audio, mime: again.mime, cached: true };
    for (let attempt = 0; ; attempt++) {
      const wait = azureLimiter.waitMs();
      if (wait > 0) await sleep(wait + 50);
      azureLimiter.record();
      try {
        const buf = await azureSynthesize({ key: s.azureKey, region: s.azureRegion, voice, text });
        const clip: CachedClip = { audio: bytesToBase64(buf), mime: 'audio/mpeg', ts: Date.now() };
        await idbSet('tts', cacheKey, clip).catch(() => undefined);
        return { audio: clip.audio, mime: clip.mime, cached: false };
      } catch (err) {
        if (err instanceof AzureError && err.status === 429 && attempt < 2) {
          await sleep(3000 * (attempt + 1));
          continue;
        }
        throw err;
      }
    }
  });
}

async function azureVoices(lang: string, key?: string, region?: string) {
  const s = await loadSettings();
  const k = key ?? s.azureKey;
  const r = region ?? s.azureRegion;
  if (!k.trim()) throw new Error('No Azure key configured.');
  if (!isValidAzureRegion(r)) throw new Error(`Unknown Azure region "${r}".`);
  const all = await azureListVoices(k, r);
  return voicesForLanguage(all, lang).map((v) => ({ shortName: v.ShortName, displayName: v.LocalName && v.LocalName !== v.DisplayName ? `${v.DisplayName} (${v.LocalName})` : v.DisplayName, locale: v.Locale, gender: v.Gender }));
}

const isShortString = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    // Only our own extension pages and content scripts can reach this listener; still validate shapes.
    if (sender.id !== browser.runtime.id) return false;
    switch (message?.type) {
      case 'lookup':
        if (!isShortString(message.word, 200) || !isShortString(message.lang, 12)) {
          sendResponse({ error: 'Bad lookup request' });
          return false;
        }
        lookupWithCache(message.word, message.lang).then(sendResponse, (err: unknown) => sendResponse({ error: errorMessage(err) }));
        return true;
      case 'anki-export':
        ankiExport(message.ids).then(sendResponse, (err: unknown) => sendResponse({ error: errorMessage(err) }));
        return true;
      case 'tts-azure':
        if (!isShortString(message.text, 1000) || !isShortString(message.lang, 12)) {
          sendResponse({ error: 'Bad text-to-speech request' });
          return false;
        }
        azureTts(message.text, message.lang, message.voice).then(sendResponse, (err: unknown) => sendResponse({ error: errorMessage(err) }));
        return true;
      case 'azure-voices':
        azureVoices(message.lang, message.key, message.region).then((voices) => sendResponse({ voices }), (err: unknown) => sendResponse({ error: errorMessage(err) }));
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

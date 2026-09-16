/**
 * Chrome's built-in Translator API (Chrome 138+). Runs on-device, no key, no quota.
 * `create()` may need a user gesture the first time a language pack is downloaded.
 */
export type MtAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface TranslatorInstance {
  translate(input: string): Promise<string>;
}

interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<MtAvailability>;
  create(o: { sourceLanguage: string; targetLanguage: string; monitor?: (m: EventTarget) => void }): Promise<TranslatorInstance>;
}

const api = (): TranslatorStatic | undefined => (globalThis as unknown as { Translator?: TranslatorStatic }).Translator;

const instances = new Map<string, Promise<TranslatorInstance>>();
const cache = new Map<string, string>();
const MAX_CACHE = 3000;

export const mtSupported = (): boolean => Boolean(api());

export async function mtAvailability(source: string, target: string): Promise<MtAvailability> {
  const T = api();
  if (!T) return 'unavailable';
  try {
    return await T.availability({ sourceLanguage: source, targetLanguage: target });
  } catch {
    return 'unavailable';
  }
}

export function getTranslator(source: string, target: string, onProgress?: (fraction: number) => void): Promise<TranslatorInstance> {
  const key = `${source}>${target}`;
  let p = instances.get(key);
  if (!p) {
    const T = api();
    if (!T) return Promise.reject(new Error('Translator API unavailable'));
    p = T.create({
      sourceLanguage: source,
      targetLanguage: target,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => onProgress?.((e as ProgressEvent).loaded));
      },
    });
    instances.set(key, p);
    p.catch(() => instances.delete(key));
  }
  return p;
}

export const isUserGestureError = (err: unknown): boolean =>
  err instanceof Error && (err.name === 'NotAllowedError' || /user (gesture|activation)/i.test(err.message));

export async function translateText(source: string, target: string, text: string, onProgress?: (fraction: number) => void): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const key = `${source}>${target}:${trimmed}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const translator = await getTranslator(source, target, onProgress);
  const out = (await translator.translate(trimmed)).trim();
  cache.set(key, out);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  return out;
}

import { freeDictUrl, parseFreeDict, type FreeDictResponse } from './freedict';
import { parseWiktionaryRest, wiktionaryUrl, type WiktionaryRestResponse } from './wiktionary';
import type { DictEntry, DictResult } from './types';

type FetchLike = typeof fetch;

async function fetchJson<T>(url: string, fetchFn: FetchLike, init?: RequestInit): Promise<T | undefined> {
  const res = await fetchFn(url, init);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function lookupOnce(
  word: string,
  lang: string,
  fetchFn: FetchLike,
): Promise<{ entries: DictEntry[]; lemma?: string; source: DictResult['source']; sourceUrl?: string }> {
  const fd = await fetchJson<FreeDictResponse>(freeDictUrl(word, lang), fetchFn).catch(() => undefined);
  if (fd) {
    const parsed = parseFreeDict(fd);
    if (parsed.entries.length) return { ...parsed, source: 'freedictionaryapi', sourceUrl: fd.source?.url };
  }
  const wk = await fetchJson<WiktionaryRestResponse>(wiktionaryUrl(word), fetchFn, {
    headers: { accept: 'application/json' },
  }).catch(() => undefined);
  if (wk) {
    const parsed = parseWiktionaryRest(wk, lang);
    if (parsed.entries.length) {
      return { ...parsed, source: 'wiktionary', sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}#French` };
    }
  }
  return { entries: [], source: 'none' };
}

/** Candidate spellings to try, in order. */
export function candidates(word: string): string[] {
  const out: string[] = [];
  const push = (w: string) => {
    if (w && !out.includes(w)) out.push(w);
  };
  const base = word.replace(/’/g, "'").trim();
  push(base);
  push(base.toLowerCase());
  push(base.replace(/^['-]+|['-]+$/g, ''));
  // hyphenated compounds: dis-moi -> dis, va-t-il -> va
  if (base.includes('-')) push(base.split('-')[0].toLowerCase());
  return out.filter(Boolean);
}

export async function lookupWord(word: string, lang: string, fetchFn: FetchLike = fetch): Promise<DictResult> {
  let hit: Awaited<ReturnType<typeof lookupOnce>> | undefined;
  let usedWord = word;
  for (const cand of candidates(word)) {
    const r = await lookupOnce(cand, lang, fetchFn);
    if (r.entries.length) {
      hit = r;
      usedWord = cand;
      break;
    }
  }
  if (!hit) return { word, lang, entries: [], source: 'none', notFound: true };

  const result: DictResult = {
    word: usedWord,
    lang,
    entries: hit.entries,
    lemma: hit.lemma && hit.lemma.toLowerCase() !== usedWord.toLowerCase() ? hit.lemma : undefined,
    source: hit.source,
    sourceUrl: hit.sourceUrl,
  };
  if (result.lemma) {
    const lemmaHit = await lookupOnce(result.lemma, lang, fetchFn).catch(() => undefined);
    if (lemmaHit?.entries.length) result.lemmaEntries = lemmaHit.entries;
  }
  return result;
}

/**
 * Runs in the page's MAIN world on youtube.com. It has access to the YouTube
 * player object and the page's sessionStorage, which is where the caption
 * URLs and the proof-of-origin token ("pot") live. Nothing here touches
 * extension APIs; it talks to the isolated content script through
 * CustomEvents carrying JSON strings.
 *
 * Caption discovery and PoToken decoding are adapted from asbplayer
 * (https://github.com/asbplayer/asbplayer, MIT). See THIRD_PARTY_NOTICES.md.
 */
import { defineContentScript } from '#imports';
import { baseLang, type SubtitleTrack, type TrackData } from '@/lib/subtitles/types';
import type { AudioTrackSummary } from '@/lib/youtube/bridge';

declare global {
  interface Window {
    ytcfg?: { get?: (key: string) => unknown };
  }
}

interface RawCaptionTrack {
  baseUrl?: string;
  url?: string;
  languageCode?: string;
  kind?: string;
  vssId?: string;
  isTranslatable?: boolean;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
}

interface AudioTrackInfo {
  id?: string;
  name?: string;
  displayName?: string;
  kind?: string;
  isDefault?: boolean;
  audioIsDefault?: boolean;
  isAutoDubbed?: boolean;
}

interface RawAudioTrack {
  id?: string;
  getLanguageInfo?: () => AudioTrackInfo | undefined;
  languageInfo?: AudioTrackInfo;
  audioTrack?: AudioTrackInfo;
  displayName?: string;
}

interface MoviePlayer extends HTMLElement {
  getAvailableAudioTracks?: () => RawAudioTrack[] | undefined;
  setAudioTrack?: (track: RawAudioTrack) => boolean | void;
  getAudioTrack?: () => { captionTracks?: RawCaptionTrack[] } | undefined;
  getVideoData?: () => { title?: string; video_id?: string } | undefined;
  getPlayerResponse?: () => PlayerResponse | undefined;
  loadModule?: (name: string) => void;
  unloadModule?: (name: string) => void;
  getOption?: (module: string, option: string) => unknown;
  setOption?: (module: string, option: string, value: unknown) => void;
}

const log = (...args: unknown[]) => console.debug('[Sublingo]', ...args);

interface PlayerResponse {
  videoDetails?: { title?: string; videoId?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: RawCaptionTrack[] } };
}

interface Discovered {
  raw: RawCaptionTrack[];
  pot?: string;
  title?: string;
}

const safe = <T>(fn: () => T): T | undefined => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function pollFor<T>(fn: () => T | undefined, timeoutMs: number, intervalMs = 200): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = safe(fn);
    if (v !== undefined) return v;
    await sleep(intervalMs);
  }
  return undefined;
}

const player = () => document.querySelector<MoviePlayer>('#movie_player');

function inferVideoId(): string | undefined {
  const m = /\/(?:shorts|embed|live)\/([^/?#]+)/.exec(location.pathname);
  if (m) return m[1];
  return new URLSearchParams(location.search).get('v') ?? undefined;
}

const trackLabel = (t: RawCaptionTrack): string =>
  t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode || 'unknown';

function potFromTracks(tracks: RawCaptionTrack[]): string | undefined {
  for (const t of tracks) {
    const u = t.url || t.baseUrl;
    if (!u) continue;
    const pot = safe(() => new URL(u, location.href).searchParams.get('pot'));
    if (pot) return pot;
  }
  return undefined;
}

function finalizeUrl(raw: string, pot?: string): string {
  const url = new URL(raw, location.href);
  url.searchParams.set('fmt', 'json3');
  const client = window.ytcfg?.get?.('INNERTUBE_CLIENT_NAME');
  url.searchParams.set('c', typeof client === 'string' && client ? client : 'WEB');
  if (pot && !url.searchParams.get('pot')) url.searchParams.set('pot', pot);
  return url.toString();
}

// ---------- PoToken recovery from sessionStorage (asbplayer, MIT) ----------

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function computeHash(input: string, start = 0, end = input.length): number {
  let hash = 0;
  for (let i = start; i < end; i++) hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0;
  return hash;
}

function transformData(data32: Uint32Array, videoId: string) {
  const mid = videoId.length >> 1;
  const key1 = computeHash(videoId, 0, mid);
  const key2 = computeHash(videoId, mid);
  const firstWord = data32[0];
  for (let i = 1; i < data32.length; i += 2) {
    let a = firstWord;
    let b = i;
    let c = key1;
    let d = key2;
    for (let round = 0; round < 22; round++) {
      b = ((b >>> 8) | (b << 24)) + a;
      b ^= c + 38293;
      a = ((a << 3) | (a >>> 29)) ^ b;
      d = ((d >>> 8) | (d << 24)) + c;
      d ^= round + 38293;
      c = ((c << 3) | (c >>> 29)) ^ d;
    }
    data32[i] ^= a;
    if (i + 1 < data32.length) data32[i + 1] ^= b;
  }
}

function decodeCachedPoToken(videoId: string, encoded: string): { poToken: string; expires: Date } | undefined {
  const bytes = base64ToBytes(encoded);
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  padded.set(bytes);
  transformData(new Uint32Array(padded.buffer), videoId);
  const data = padded.subarray(0, bytes.length);

  let index = 4;
  while (index < 7 && data[index] === 0) index++;
  const VALIDATION = [196, 200, 224, 18];
  for (const expected of VALIDATION) {
    if (data[index++] !== expected) return undefined;
  }
  const timestamp = new DataView(data.buffer, data.byteOffset).getUint32(index);
  index += 4;
  const poToken = bytesToBase64(data.subarray(index)).replace(/\//g, '_').replace(/\+/g, '-').replace(/=+$/g, '');
  return { poToken, expires: new Date(timestamp * 1000) };
}

function decodePoToken(videoId: string): string | undefined {
  const keyList = sessionStorage.getItem('iU5q-!O9@$');
  if (!keyList) return undefined;
  let found: string | undefined;
  for (const key of keyList.split(',')) {
    const encoded = sessionStorage.getItem(key);
    if (!encoded) continue;
    const decoded = safe(() => decodeCachedPoToken(videoId, encoded));
    if (decoded) found = decoded.poToken;
  }
  return found;
}

// ---------- Fallback sources ----------

async function androidInnerTube(videoId: string): Promise<Discovered | undefined> {
  const apiKey = window.ytcfg?.get?.('INNERTUBE_API_KEY');
  if (typeof apiKey !== 'string' || !apiKey) return undefined;
  const hl = window.ytcfg?.get?.('HL');
  const res = await fetch(`https://${location.host}/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', hl: typeof hl === 'string' ? hl : 'en' } },
      videoId,
    }),
  });
  if (!res.ok) return undefined;
  const payload = (await res.json()) as PlayerResponse;
  const raw = payload.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  return { raw, title: payload.videoDetails?.title };
}

function extractJsonObject(src: string, marker: string): unknown {
  const at = src.indexOf(marker);
  if (at < 0) return undefined;
  const start = src.indexOf('{', at);
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return safe(() => JSON.parse(src.slice(start, i + 1)));
    }
  }
  return undefined;
}

async function playerResponseFromPage(): Promise<PlayerResponse | undefined> {
  const res = await fetch(location.href, { credentials: 'include' });
  if (!res.ok) return undefined;
  const html = await res.text();
  return extractJsonObject(html, 'ytInitialPlayerResponse = ') as PlayerResponse | undefined;
}

// ---------- Capture the player's own timedtext requests (they carry a valid pot) ----------

const capturedTimedText = new Map<string, string>();

function noteUrl(u: unknown) {
  if (typeof u !== 'string' || !u.includes('/api/timedtext')) return;
  const url = safe(() => new URL(u, location.href));
  if (!url) return;
  const v = url.searchParams.get('v');
  if (v && url.searchParams.get('pot')) capturedTimedText.set(v, url.toString());
}

function installNetworkCapture() {
  safe(() => {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) noteUrl(entry.name);
    });
    po.observe({ type: 'resource', buffered: true });
  });
  safe(() => {
    const origFetch = window.fetch;
    window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      noteUrl(typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url);
      return origFetch.call(this, input, init);
    } as typeof fetch;
  });
  safe(() => {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      noteUrl(args[1] instanceof URL ? args[1].href : args[1]);
      return (origOpen as unknown as (...a: unknown[]) => void).apply(this, args);
    } as typeof XMLHttpRequest.prototype.open;
  });
}

/** Ask the player to load a caption track so it mints a pot and requests timedtext itself. */
function nudgeCaptions(pl: MoviePlayer, preferredLang?: string): () => void {
  const wasOn = Boolean(safe(() => (pl.getOption?.('captions', 'track') as { languageCode?: string } | undefined)?.languageCode));
  safe(() => pl.loadModule?.('captions'));
  const list = safe(() => pl.getOption?.('captions', 'tracklist') as RawCaptionTrack[] | undefined) ?? [];
  const track =
    (preferredLang && list.find((t) => t.languageCode && baseLang(t.languageCode) === baseLang(preferredLang))) || list[0];
  if (track) {
    safe(() => pl.setOption?.('captions', 'track', { languageCode: track.languageCode, ...(track.kind ? { kind: track.kind } : {}) }));
  } else if (preferredLang) {
    safe(() => pl.setOption?.('captions', 'track', { languageCode: baseLang(preferredLang) }));
  }
  log('nudged captions', { wasOn, picked: track?.languageCode, listed: list.length });
  return () => {
    if (!wasOn) safe(() => pl.unloadModule?.('captions'));
  };
}

function potFor(videoId: string, tracks: RawCaptionTrack[] | undefined): string | undefined {
  const fromTracks = tracks ? potFromTracks(tracks) : undefined;
  if (fromTracks) return fromTracks;
  const captured = capturedTimedText.get(videoId);
  if (captured) return safe(() => new URL(captured).searchParams.get('pot')) ?? undefined;
  return undefined;
}

// ---------- Discovery ----------

async function discover(videoId: string, preferredLang?: string): Promise<Discovered> {
  const p = player();
  const pr = safe(() => p?.getPlayerResponse?.());
  const prMatches = pr?.videoDetails?.videoId === videoId;
  const prTracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  // Fast exit: the current video has no caption tracks at all.
  if (pr && prMatches && !pr.captions) {
    log('player response says no captions');
    return { raw: [], title: pr.videoDetails?.title };
  }

  const playerTracks = () => {
    const pl = player();
    const pid = pl?.getVideoData?.()?.video_id;
    const tracks = pl?.getAudioTrack?.()?.captionTracks;
    return (pid === undefined || pid === videoId) && tracks && tracks.length > 0 ? tracks : undefined;
  };

  // Poll for a proof-of-origin token. The player mints one a few seconds after load; if it
  // has not by 1.5 s, load the captions module once so it requests a track itself.
  let pot: string | undefined;
  let source = 'none';
  let restore: (() => void) | undefined;
  const started = Date.now();
  while (Date.now() - started < 15000) {
    pot = safe(() => potFor(videoId, playerTracks()));
    if (pot) {
      source = restore ? 'nudge' : 'player';
      break;
    }
    if (!restore && Date.now() - started > 1500 && p) restore = nudgeCaptions(p, preferredLang);
    await sleep(250);
  }

  // Last resort: a token cached in sessionStorage.
  if (!pot) {
    pot = safe(() => decodePoToken(videoId));
    source = pot ? 'sessionStorage' : 'none';
  }

  let raw = playerTracks() ?? (prMatches ? prTracks : undefined) ?? [];
  let title = p?.getVideoData?.()?.title || pr?.videoDetails?.title;

  if (raw.length === 0) {
    const android = await androidInnerTube(videoId).catch(() => undefined);
    if (android && android.raw.length > 0) {
      raw = android.raw;
      title = title || android.title;
      source += '+android';
    }
  }
  if (raw.length === 0) {
    const page = await playerResponseFromPage().catch(() => undefined);
    const pageTracks = page?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (pageTracks && pageTracks.length > 0) {
      raw = pageTracks;
      title = title || page?.videoDetails?.title;
      source += '+page';
    }
  }

  restore?.();
  log('discovery', { videoId, source, pot: pot ? 'present' : null, tracks: raw.map((t) => `${t.languageCode}:${t.kind ?? 'manual'}`) });
  return { raw, pot, title };
}

const KIND_ORDER: Record<SubtitleTrack['kind'], number> = { manual: 0, asr: 1, translated: 2 };

function buildTracks(raw: RawCaptionTrack[], pot: string | undefined, wantedLangs: string[]): SubtitleTrack[] {
  const tracks: SubtitleTrack[] = [];
  for (const t of raw) {
    const u = t.url || t.baseUrl;
    if (!u || !t.languageCode) continue;
    const kind: SubtitleTrack['kind'] = t.kind === 'asr' ? 'asr' : 'manual';
    tracks.push({
      id: `${t.languageCode}:${kind}:${t.vssId ?? ''}`,
      lang: t.languageCode,
      label: trackLabel(t),
      kind,
      url: finalizeUrl(u, pot),
    });
  }

  // YouTube machine-translates any translatable track for free via `tlang`.
  const source = [...tracks].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])[0];
  if (source) {
    for (const lang of wantedLangs) {
      if (!lang) continue;
      const already = tracks.some((t) => baseLang(t.lang) === baseLang(lang));
      if (already) continue;
      const url = new URL(source.url);
      url.searchParams.set('tlang', lang);
      tracks.push({
        id: `${lang}:translated:${source.id}`,
        lang,
        label: `${lang.toUpperCase()} (auto-translated from ${source.lang})`,
        kind: 'translated',
        url: url.toString(),
        sourceLang: source.lang,
      });
    }
  }
  return tracks;
}

// ---------- Audio tracks (dub mode tier 0) ----------

/** The language info object lives under a minified key; find it by shape ({ id, name }). */
function findLanguageInfo(track: RawAudioTrack): AudioTrackInfo {
  const direct = safe(() => track.getLanguageInfo?.()) ?? track.languageInfo ?? track.audioTrack;
  if (direct && (direct.id || direct.name)) return direct;
  for (const value of Object.values(track as Record<string, unknown>)) {
    if (value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      if (typeof v.id === 'string' && typeof v.name === 'string') return v as AudioTrackInfo;
    }
  }
  return {};
}

function describeAudioTrack(track: RawAudioTrack, index: number, currentId?: string): AudioTrackSummary {
  const info = findLanguageInfo(track);
  const id = String(info.id ?? track.id ?? index);
  const lang = id.split(/[.\-_;]/)[0].toLowerCase();
  return {
    index,
    id,
    lang,
    name: info.name ?? info.displayName ?? track.displayName ?? id,
    kind: info.kind ?? (info.isAutoDubbed ? 'dubbed-auto' : ''),
    isDefault: Boolean(info.isDefault ?? info.audioIsDefault),
    current: currentId !== undefined && id === currentId,
  };
}

function listAudioTracks(): { tracks: AudioTrackSummary[]; raw: RawAudioTrack[] } {
  const p = player();
  const raw = safe(() => p?.getAvailableAudioTracks?.()) ?? [];
  const current = safe(() => (p?.getAudioTrack?.() as RawAudioTrack | undefined));
  const currentId = current ? describeAudioTrack(current, -1).id : undefined;
  return { raw, tracks: raw.map((t, i) => describeAudioTrack(t, i, currentId)) };
}

// ---------- Bridge ----------

/** Only YouTube's own caption endpoint may be fetched on behalf of the isolated script. */
export function isTimedTextUrl(raw: string): boolean {
  const url = safe(() => new URL(raw, location.href));
  return Boolean(url && url.protocol === 'https:' && /(^|\.)youtube\.com$/.test(url.hostname) && url.pathname === '/api/timedtext');
}

const respond = (eventName: string, detail: object) =>
  document.dispatchEvent(new CustomEvent(eventName, { detail: JSON.stringify(detail) }));

const parseDetail = <T>(e: Event): T | undefined => safe(() => JSON.parse((e as CustomEvent<string>).detail) as T);

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installNetworkCapture();
    document.addEventListener('sublingo:get-tracks', (e) => {
      const req = parseDetail<{ requestId: string; wantedLangs?: string[] }>(e);
      if (!req) return;
      void (async () => {
        const videoId = inferVideoId();
        if (!videoId) {
          respond('sublingo:tracks', { requestId: req.requestId, error: 'Not on a video page.' });
          return;
        }
        try {
          const found = await discover(videoId, req.wantedLangs?.[0]);
          const data: TrackData & { requestId: string } = {
            requestId: req.requestId,
            videoId,
            title: found.title || player()?.getVideoData?.()?.title || document.title,
            tracks: buildTracks(found.raw, found.pot, req.wantedLangs ?? []),
          };
          respond('sublingo:tracks', data);
        } catch (err) {
          respond('sublingo:tracks', { requestId: req.requestId, videoId, error: err instanceof Error ? err.message : String(err) });
        }
      })();
    });

    document.addEventListener('sublingo:audio-tracks', (e) => {
      const req = parseDetail<{ requestId: string }>(e);
      if (!req) return;
      const { tracks } = listAudioTracks();
      respond('sublingo:audio-tracks-result', { requestId: req.requestId, tracks });
    });

    document.addEventListener('sublingo:set-audio-track', (e) => {
      const req = parseDetail<{ requestId: string; id: string }>(e);
      if (!req) return;
      const { raw, tracks } = listAudioTracks();
      const target = tracks.find((t) => t.id === req.id);
      const p = player();
      if (!target || !p?.setAudioTrack) {
        respond('sublingo:set-audio-track-result', { requestId: req.requestId, ok: false, error: 'Audio track not found' });
        return;
      }
      const ok = safe(() => p.setAudioTrack!(raw[target.index])) !== false;
      log('set audio track', target.name, ok);
      respond('sublingo:set-audio-track-result', { requestId: req.requestId, ok });
    });

    document.addEventListener('sublingo:fetch', (e) => {
      const req = parseDetail<{ requestId: string; url: string }>(e);
      if (!req) return;
      if (!isTimedTextUrl(req.url)) {
        respond('sublingo:fetched', { requestId: req.requestId, ok: false, error: 'Refused: not a YouTube caption URL' });
        return;
      }
      fetch(req.url, { credentials: 'include' })
        .then(async (res) => {
          const text = await res.text();
          respond('sublingo:fetched', { requestId: req.requestId, ok: res.ok && text.trim().length > 0, text, error: res.ok ? undefined : `HTTP ${res.status}` });
        })
        .catch((err) => respond('sublingo:fetched', { requestId: req.requestId, ok: false, error: String(err) }));
    });
  },
});

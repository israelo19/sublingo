import { browser, createShadowRootUi, defineContentScript, type ContentScriptContext } from '#imports';
import { h, render } from 'preact';
import type { LookupResponse } from '@/lib/messages';
import { installHotkeys, type HotkeyMap } from '@/lib/hotkeys';
import { App, type OverlayActions } from '@/lib/overlay/App';
import { closePopup, openPopup, patchPopup, primaryCue, secondaryText, state } from '@/lib/overlay/store';
import { createHtml5Adapter } from '@/lib/player/html5';
import type { PlayerAdapter } from '@/lib/player/types';
import { DEFAULT_SETTINGS, settingsItem, type Settings } from '@/lib/settings';
import { activeIndex, nextIndex, previousIndex } from '@/lib/subtitles/active';
import { parseJson3 } from '@/lib/subtitles/json3';
import { baseLang, type SubtitleTrack, type TrackData } from '@/lib/subtitles/types';
import { saveVocab } from '@/lib/vocab';
import { YoutubeBridge } from '@/lib/youtube/bridge';
import '@/lib/overlay/overlay.css';

const HIDE_NATIVE_STYLE_ID = 'sublingo-hide-native-captions';
const KIND_ORDER: Record<SubtitleTrack['kind'], number> = { manual: 0, asr: 1, translated: 2 };

const pickTrack = (tracks: SubtitleTrack[], lang: string): SubtitleTrack | undefined =>
  tracks
    .filter((t) => baseLang(t.lang) === baseLang(lang))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])[0];

const trackBadge = (t: SubtitleTrack): string =>
  `${baseLang(t.lang).toUpperCase()}${t.kind === 'asr' ? ' auto' : t.kind === 'translated' ? ' MT' : ''}`;

/** The <video> YouTube is actually playing right now. Prefers a playing element if several exist. */
function resolveYoutubeVideo(): HTMLVideoElement | null {
  const inPlayer = Array.from(document.querySelectorAll<HTMLVideoElement>('#movie_player video'));
  if (inPlayer.length === 0) return document.querySelector<HTMLVideoElement>('video.html5-main-video');
  return (
    inPlayer.find((v) => !v.paused && v.readyState > 0) ??
    inPlayer.find((v) => v.classList.contains('html5-main-video')) ??
    inPlayer[0]
  );
}

const isWatchPage = () => location.pathname === '/watch' || location.pathname.startsWith('/shorts/');

const videoIdFromLocation = (): string | undefined =>
  new URLSearchParams(location.search).get('v') ?? /\/shorts\/([^/?#]+)/.exec(location.pathname)?.[1] ?? undefined;

function waitFor<T>(fn: () => T | null | undefined, timeoutMs: number, intervalMs = 250): Promise<T | undefined> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const v = fn();
      if (v) return resolve(v);
      if (Date.now() > deadline) return resolve(undefined);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

class SublingoYouTube {
  private readonly bridge = new YoutubeBridge();
  private player?: PlayerAdapter;
  private ui?: Awaited<ReturnType<typeof createShadowRootUi>>;
  private loadSeq = 0;
  private lastIdx = -1;
  private autoPausedFor = -1;
  private videoId?: string;
  private title = '';
  private langKey = '';

  constructor(private readonly ctx: ContentScriptContext) {}

  private readonly actions: OverlayActions = {
    onWordClick: (word, sentence, x, y) => void this.onWordClick(word, sentence, x, y),
    onClosePopup: () => closePopup(),
    onSave: () => void this.saveCurrent(),
    onToggleSecondary: () => void this.updateSettings({ showSecondary: !state.settings.value.showSecondary }),
    onLookupLemma: (lemma) => void this.lookupInPopup(lemma),
  };

  async init(): Promise<void> {
    const settings = await settingsItem.getValue();
    state.settings.value = settings;
    this.langKey = `${settings.primaryLang}|${settings.secondaryLang}`;

    settingsItem.watch((next) => {
      const s = next ?? DEFAULT_SETTINGS;
      state.settings.value = s;
      this.applyNativeCaptionRule();
      const key = `${s.primaryLang}|${s.secondaryLang}`;
      if (key !== this.langKey) {
        this.langKey = key;
        if (this.videoId) void this.load();
      }
    });

    installHotkeys(this.ctx, () => this.hotkeys());
    this.ctx.addEventListener(document, 'yt-navigate-finish' as keyof DocumentEventMap, () => void this.onNavigate());
    this.ctx.onInvalidated(() => this.teardown());
    await this.onNavigate();
  }

  private hotkeys(): HotkeyMap {
    if (state.status.value !== 'ready') {
      return state.popup.value ? { escape: () => closePopup() } : {};
    }
    return {
      a: () => this.seekToIndex(previousIndex(state.primaryCues.value, this.player?.currentTime() ?? 0)),
      s: () => this.replay(),
      d: () => this.seekToIndex(nextIndex(state.primaryCues.value, this.player?.currentTime() ?? 0)),
      q: () => void this.updateSettings({ autoPause: !state.settings.value.autoPause }),
      w: () => void this.updateSettings({ showSecondary: !state.settings.value.showSecondary }),
      escape: () => closePopup(),
    };
  }

  private async onNavigate(): Promise<void> {
    if (!isWatchPage()) {
      this.videoId = undefined;
      this.resetState('idle', '');
      return;
    }
    const id = videoIdFromLocation();
    if (!id) return;
    if (id === this.videoId && state.status.value !== 'idle') return;
    this.videoId = id;
    await this.mountIfNeeded();
    await this.load();
  }

  private async mountIfNeeded(): Promise<void> {
    const playerEl = await waitFor(() => document.querySelector<HTMLElement>('#movie_player'), 20000);
    if (!playerEl) return;
    await waitFor(resolveYoutubeVideo, 20000);

    if (!this.player) {
      this.player = createHtml5Adapter(resolveYoutubeVideo);
      this.player.onTime((t, paused) => this.tick(t, paused));
    }

    if (!this.ui) {
      this.ui = await createShadowRootUi(this.ctx, {
        name: 'sublingo-overlay',
        position: 'inline',
        anchor: '#movie_player',
        append: 'last',
        onMount: (container) => {
          container.className = 'sl-container';
          render(h(App, { actions: this.actions }), container);
        },
        onRemove: (container) => {
          if (container) render(null, container);
        },
      });
      // The host box (absolute, inset 0, pointer-events none) is styled in overlay.css via
      // `:host(sublingo-overlay)`; see the note there about WXT's `all: initial !important` reset.
      this.ui.autoMount();
    }
  }

  private resetState(status: 'idle' | 'loading', message: string) {
    state.status.value = status;
    state.statusMessage.value = message;
    state.primaryCues.value = [];
    state.secondaryCues.value = [];
    state.displayIndex.value = -1;
    state.primaryLabel.value = '';
    state.secondaryLabel.value = '';
    this.lastIdx = -1;
    this.autoPausedFor = -1;
    closePopup();
    this.applyNativeCaptionRule();
  }

  private fail(message: string) {
    state.status.value = 'error';
    state.statusMessage.value = message;
    this.applyNativeCaptionRule();
  }

  private async load(): Promise<void> {
    const seq = ++this.loadSeq;
    const s = state.settings.value;
    this.resetState('loading', 'Sublingo: loading captions…');

    let data: TrackData;
    try {
      data = await this.bridge.getTracks([s.primaryLang, s.secondaryLang]);
    } catch (err) {
      if (seq === this.loadSeq) this.fail(`Sublingo could not read YouTube captions (${err instanceof Error ? err.message : String(err)})`);
      return;
    }
    if (seq !== this.loadSeq) return;
    if (data.error) return this.fail(`Sublingo: ${data.error}`);
    this.title = data.title;
    if (!data.tracks.length) return this.fail('Sublingo: this video has no captions.');

    let primary = pickTrack(data.tracks, s.primaryLang);
    let secondary = s.secondaryLang ? pickTrack(data.tracks, s.secondaryLang) : undefined;
    if (!primary) return this.fail(`Sublingo: no ${s.primaryLang.toUpperCase()} captions on this video.`);

    // YouTube answers with an empty 200 when the proof-of-origin token is not ready yet
    // (the "pot race"). Back off, ask the page for a fresh track list, and retry.
    let primaryText = '';
    let secondaryText = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      [primaryText, secondaryText] = await Promise.all([
        this.fetchTrack(primary.url).catch(() => ''),
        secondary ? this.fetchTrack(secondary.url).catch(() => '') : Promise.resolve(''),
      ]);
      if (seq !== this.loadSeq) return;
      if (primaryText.trim()) break;
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      const fresh = await this.bridge.getTracks([s.primaryLang, s.secondaryLang]).catch(() => undefined);
      if (seq !== this.loadSeq) return;
      if (fresh?.tracks.length) {
        primary = pickTrack(fresh.tracks, s.primaryLang) ?? primary;
        secondary = s.secondaryLang ? pickTrack(fresh.tracks, s.secondaryLang) ?? secondary : undefined;
      }
    }

    const primaryCues = parseJson3(primaryText);
    if (!primaryCues.length) return this.fail('Sublingo: the caption track came back empty. Try reloading the page.');

    state.primaryCues.value = primaryCues;
    state.secondaryCues.value = secondaryText ? parseJson3(secondaryText) : [];
    state.primaryLabel.value = trackBadge(primary);
    state.secondaryLabel.value = secondary && state.secondaryCues.value.length ? trackBadge(secondary) : '';
    state.status.value = 'ready';
    state.statusMessage.value = '';
    this.applyNativeCaptionRule();
    if (this.player) this.tick(this.player.currentTime(), this.player.paused());
  }

  private async fetchTrack(url: string): Promise<string> {
    try {
      const res = await fetch(url, { credentials: 'include' });
      const text = res.ok ? await res.text() : '';
      console.debug('[Sublingo] fetched track', res.status, text.length, url.slice(0, 140));
      if (text.trim()) return text;
    } catch {
      // fall through to page-context fetch
    }
    return this.bridge.fetchText(url);
  }

  private applyNativeCaptionRule() {
    const s = state.settings.value;
    const shouldHide = s.enabled && s.hideNativeCaptions && state.status.value === 'ready';
    const existing = document.getElementById(HIDE_NATIVE_STYLE_ID);
    if (shouldHide && !existing) {
      const style = document.createElement('style');
      style.id = HIDE_NATIVE_STYLE_ID;
      style.textContent = '.ytp-caption-window-container, .caption-window { display: none !important; }';
      document.head.appendChild(style);
    } else if (!shouldHide && existing) {
      existing.remove();
    }
  }

  private tick(t: number, paused: boolean) {
    state.time.value = t;
    state.paused.value = paused;
    const cues = state.primaryCues.value;
    if (!cues.length || state.status.value !== 'ready') return;

    // Pre-roll and mid-roll ads reuse the same <video>; hide captions while one plays.
    if (document.querySelector('#movie_player.ad-showing')) {
      state.displayIndex.value = -1;
      return;
    }

    const idx = activeIndex(cues, t, 0);
    if (paused) {
      // Frozen: keep whatever line was showing unless we have been seeked into another one.
      if (idx >= 0) {
        state.displayIndex.value = idx;
        this.lastIdx = idx;
      }
      return;
    }

    if (idx !== this.lastIdx) {
      const prev = this.lastIdx;
      const s = state.settings.value;
      if (prev >= 0 && s.autoPause && this.autoPausedFor !== prev && t >= cues[prev].end - 0.3 && t < cues[prev].end + 1.5) {
        this.autoPausedFor = prev;
        this.player?.pause();
        this.player?.seek(Math.max(cues[prev].start, cues[prev].end - 0.05));
        state.displayIndex.value = prev;
        return;
      }
      this.lastIdx = idx;
    }
    state.displayIndex.value = idx >= 0 ? idx : activeIndex(cues, t, 0.35);
  }

  private seekToIndex(i: number) {
    const cues = state.primaryCues.value;
    if (i < 0 || i >= cues.length || !this.player) return;
    this.autoPausedFor = -1;
    this.lastIdx = i;
    state.displayIndex.value = i;
    closePopup();
    this.player.seek(cues[i].start + 0.01);
    this.player.play();
  }

  private replay() {
    const cues = state.primaryCues.value;
    const i = state.displayIndex.value >= 0 ? state.displayIndex.value : activeIndex(cues, this.player?.currentTime() ?? 0, 1);
    this.seekToIndex(i);
  }

  private async updateSettings(patch: Partial<Settings>) {
    await settingsItem.setValue({ ...state.settings.value, ...patch });
  }

  private lookup(word: string): Promise<LookupResponse> {
    return browser.runtime.sendMessage({ type: 'lookup', word, lang: baseLang(state.settings.value.primaryLang) }) as Promise<LookupResponse>;
  }

  private async onWordClick(word: string, sentence: string, x: number, y: number) {
    if (state.settings.value.pauseOnWordClick) this.player?.pause();
    openPopup({ word, sentence, x, y, loading: true });
    await this.lookupInPopup(word);
  }

  private async lookupInPopup(word: string) {
    patchPopup({ word, loading: true, error: undefined, result: undefined, saved: false });
    try {
      const res = await this.lookup(word);
      if (state.popup.value?.word !== word) return;
      if ('error' in res) patchPopup({ loading: false, error: res.error });
      else patchPopup({ loading: false, result: res });
    } catch (err) {
      if (state.popup.value?.word === word) patchPopup({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async saveCurrent() {
    const popup = state.popup.value;
    const r = popup?.result;
    if (!popup || !r || r.notFound) return;
    const entries = r.lemmaEntries ?? r.entries;
    await saveVocab({
      word: r.word,
      lemma: r.lemma,
      lang: r.lang,
      sentence: popup.sentence || primaryCue.value?.text || '',
      translation: secondaryText.value || undefined,
      definition: entries[0]?.senses[0]?.definition,
      site: 'youtube',
      videoId: this.videoId ?? '',
      title: this.title,
      time: this.player?.currentTime() ?? 0,
    });
    patchPopup({ saved: true });
  }

  private teardown() {
    this.player?.destroy();
    document.getElementById(HIDE_NATIVE_STYLE_ID)?.remove();
  }
}

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    await new SublingoYouTube(ctx).init();
  },
});

import { browser, createShadowRootUi, defineContentScript, type ContentScriptContext } from '#imports';
import { h, render } from 'preact';
import type { LookupResponse } from '@/lib/messages';
import { installHotkeys, type HotkeyMap } from '@/lib/hotkeys';
import { App, type OverlayActions } from '@/lib/overlay/App';
import { closePopup, openPopup, patchPopup, primaryCue, secondaryText, state } from '@/lib/overlay/store';
import { createHtml5Adapter } from '@/lib/player/html5';
import type { PlayerAdapter } from '@/lib/player/types';
import { loadSettings, settingsItem, watchSettings, type Settings } from '@/lib/settings';
import { activeIndex, nextIndex, previousIndex } from '@/lib/subtitles/active';
import { parseJson3 } from '@/lib/subtitles/json3';
import { baseLang, type SubtitleTrack, type TrackData } from '@/lib/subtitles/types';
import { isUserGestureError, mtSupported, translateText } from '@/lib/translate/chrome';
import { DubEngine } from '@/lib/dub/engine';
import { AzureVoiceProvider, BrowserVoiceProvider } from '@/lib/dub/providers';
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
  private hoverPaused = false;
  private mtSeq = 0;
  private mtIndex = -1;
  private mtGestureArmed = false;
  private dub?: DubEngine;
  private dubSeq = 0;
  private dubKey = '';
  private originalAudioTrackId?: string;

  constructor(private readonly ctx: ContentScriptContext) {}

  private readonly actions: OverlayActions = {
    onWordClick: (word, sentence, x, y) => void this.onWordClick(word, sentence, x, y),
    onClosePopup: () => closePopup(),
    onSave: () => void this.saveCurrent(),
    onToggleSecondary: () => void this.updateSettings({ showSecondary: !state.settings.value.showSecondary }),
    onLookupLemma: (lemma) => void this.lookupInPopup(lemma),
    onCaptionHover: (entering) => this.onCaptionHover(entering),
  };

  async init(): Promise<void> {
    const settings = await loadSettings();
    state.settings.value = settings;
    this.langKey = `${settings.primaryLang}|${settings.secondaryLang}`;

    watchSettings((s) => {
      state.settings.value = s;
      this.applyNativeCaptionRule();
      if (!s.machineTranslation) {
        state.mtLine.value = '';
        state.mtStatus.value = '';
      } else {
        this.mtIndex = -1;
        this.maybeTranslateLine();
      }
      const key = `${s.primaryLang}|${s.secondaryLang}`;
      if (key !== this.langKey) {
        this.langKey = key;
        if (this.videoId) void this.load();
      } else {
        void this.syncDub();
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
      v: () => void this.updateSettings({ dubMode: !state.settings.value.dubMode }),
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
    this.originalAudioTrackId = undefined;
    this.dubKey = '';
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
    state.mtLine.value = '';
    this.lastIdx = -1;
    this.autoPausedFor = -1;
    this.mtIndex = -1;
    this.hoverPaused = false;
    this.stopDub();
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
    let secondaryTrackText = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      [primaryText, secondaryTrackText] = await Promise.all([
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
    state.secondaryCues.value = secondaryTrackText ? parseJson3(secondaryTrackText) : [];
    state.primaryLabel.value = trackBadge(primary);
    if (secondary && state.secondaryCues.value.length) {
      state.secondaryLabel.value = trackBadge(secondary);
    } else if (s.machineTranslation && mtSupported() && s.secondaryLang) {
      state.secondaryLabel.value = `${baseLang(s.secondaryLang).toUpperCase()} MT (Chrome)`;
    } else {
      state.secondaryLabel.value = '';
    }
    state.status.value = 'ready';
    state.statusMessage.value = '';
    this.applyNativeCaptionRule();
    if (this.player) this.tick(this.player.currentTime(), this.player.paused());
    void this.syncDub();
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
    this.dub?.onTick(t, paused, idx);
    if (paused) {
      // Frozen: keep whatever line was showing unless we have been seeked into another one.
      if (idx >= 0) {
        state.displayIndex.value = idx;
        this.lastIdx = idx;
      }
      this.maybeTranslateLine();
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
    this.maybeTranslateLine();
  }

  // ---------- Chrome on-device translation of the current line ----------

  private maybeTranslateLine() {
    const index = state.displayIndex.value;
    if (index === this.mtIndex) return;
    this.mtIndex = index;
    const s = state.settings.value;
    if (!s.machineTranslation || !mtSupported() || state.secondaryCues.value.length > 0) return;
    void this.translateLine(index);
  }

  private async translateLine(index: number) {
    const cue = state.primaryCues.value[index];
    const s = state.settings.value;
    const seq = ++this.mtSeq;
    if (!cue) {
      state.mtLine.value = '';
      return;
    }
    try {
      const text = await translateText(baseLang(s.primaryLang), baseLang(s.secondaryLang), cue.text, (p) => {
        state.mtStatus.value = p < 1 ? `Downloading Chrome's ${s.primaryLang.toUpperCase()}→${s.secondaryLang.toUpperCase()} translation model… ${Math.round(p * 100)}%` : '';
      });
      if (seq !== this.mtSeq || state.displayIndex.value !== index) return;
      state.mtLine.value = text;
      state.mtStatus.value = '';
    } catch (err) {
      if (isUserGestureError(err)) {
        state.mtStatus.value = 'Click the video once to enable on-device translation';
        this.armMtGesture();
      } else {
        state.mtStatus.value = '';
        console.debug('[Sublingo] on-device translation unavailable:', err);
      }
    }
  }

  /** Translator.create() may require a user gesture the first time; retry on the next one. */
  private armMtGesture() {
    if (this.mtGestureArmed) return;
    this.mtGestureArmed = true;
    const retry = () => {
      this.mtGestureArmed = false;
      this.mtIndex = -1;
      this.maybeTranslateLine();
    };
    this.ctx.addEventListener(window, 'pointerdown', retry, { once: true, capture: true });
    this.ctx.addEventListener(window, 'keydown', retry, { once: true, capture: true });
  }

  // ---------- Dub mode: hear the video in the language you are learning ----------

  /** (Re)start or stop dubbing to match the current settings and video. Safe to call often. */
  private async syncDub(): Promise<void> {
    const s = state.settings.value;
    const key = s.dubMode ? [s.primaryLang, s.dubProvider, s.dubDuck, s.dubSlowVideo, s.azureKey ? 'k' : '', s.azureRegion, s.azureVoice, s.browserVoice, this.videoId, state.status.value].join('|') : 'off';
    if (key === this.dubKey) return;
    this.dubKey = key;
    this.stopDub();
    if (!s.dubMode || state.status.value !== 'ready' || !this.player) {
      if (!s.dubMode) await this.restoreAudioTrack();
      return;
    }
    const seq = ++this.dubSeq;
    const lang = baseLang(s.primaryLang);

    // Tier 0: the platform already has an audio track in the target language.
    try {
      const tracks = await this.bridge.getAudioTracks();
      if (seq !== this.dubSeq) return;
      const match = tracks.find((tr) => tr.lang === lang);
      if (match) {
        if (!match.current) {
          // Remember what was playing so turning dub mode off can put it back.
          const before = tracks.find((tr) => tr.current) ?? tracks.find((tr) => tr.isDefault);
          if (before && before.id !== match.id) this.originalAudioTrackId ??= before.id;
          const ok = await this.bridge.setAudioTrack(match.id);
          if (seq !== this.dubSeq) return;
          if (!ok) throw new Error('could not switch audio track');
        }
        state.dubSource.value = 'youtube';
        state.dubStatus.value = '';
        console.debug('[Sublingo] dub: using YouTube audio track', match.name);
        return;
      }
    } catch (err) {
      console.debug('[Sublingo] dub: audio track lookup failed', err);
    }

    // Tier 1/3: speak the target-language captions ourselves.
    const status = (m: string) => {
      state.dubStatus.value = m;
      if (m) setTimeout(() => (state.dubStatus.value === m ? (state.dubStatus.value = '') : undefined), 6000);
    };
    const browserVoice = new BrowserVoiceProvider(lang, s.browserVoice, () => status('Click the video once to allow the browser voice'));
    const useAzure = s.dubProvider === 'azure' || (s.dubProvider === 'auto' && s.azureKey.trim().length > 0);
    const provider = useAzure ? new AzureVoiceProvider(lang, browserVoice, status) : browserVoice;
    this.dub = new DubEngine(this.player, resolveYoutubeVideo, provider, { duck: s.dubDuck, slowVideo: s.dubSlowVideo, prefetch: 6, onStatus: status });
    this.dub.setCues(state.primaryCues.value);
    this.dub.prime(this.player.currentTime());
    state.dubSource.value = provider.name;
    console.debug('[Sublingo] dub: speaking captions with', provider.name);
    this.dub.onTick(this.player.currentTime(), this.player.paused(), activeIndex(state.primaryCues.value, this.player.currentTime(), 0));
  }

  private stopDub() {
    this.dub?.stop();
    this.dub = undefined;
    state.dubSource.value = 'none';
    state.dubStatus.value = '';
  }

  private async restoreAudioTrack() {
    if (!this.originalAudioTrackId) return;
    const id = this.originalAudioTrackId;
    this.originalAudioTrackId = undefined;
    await this.bridge.setAudioTrack(id).catch(() => false);
  }

  // ---------- Navigation and hover ----------

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

  private onCaptionHover(entering: boolean) {
    if (!state.settings.value.hoverPause || !this.player) return;
    if (entering) {
      if (!this.player.paused()) {
        this.player.pause();
        this.hoverPaused = true;
      }
    } else if (this.hoverPaused) {
      this.hoverPaused = false;
      if (!state.popup.value) this.player.play();
    }
  }

  private async updateSettings(patch: Partial<Settings>) {
    await settingsItem.setValue({ ...state.settings.value, ...patch });
  }

  // ---------- Dictionary popup ----------

  private lookup(word: string): Promise<LookupResponse> {
    return browser.runtime.sendMessage({ type: 'lookup', word, lang: baseLang(state.settings.value.primaryLang) }) as Promise<LookupResponse>;
  }

  private async onWordClick(word: string, sentence: string, x: number, y: number) {
    if (state.settings.value.pauseOnWordClick) this.player?.pause();
    openPopup({ word, sentence, x, y, loading: true });
    void this.glossInPopup(word, sentence);
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

  /** Word gloss and literal sentence translation from Chrome's on-device translator (best effort). */
  private async glossInPopup(word: string, sentence: string) {
    const s = state.settings.value;
    if (!s.machineTranslation || !mtSupported() || !s.secondaryLang) return;
    const src = baseLang(s.primaryLang);
    const tgt = baseLang(s.secondaryLang);
    const guard = () => state.popup.value?.word === word;
    try {
      const [gloss, literal] = await Promise.all([
        translateText(src, tgt, word).catch(() => ''),
        sentence ? translateText(src, tgt, sentence).catch(() => '') : Promise.resolve(''),
      ]);
      if (!guard()) return;
      patchPopup({
        gloss: gloss && gloss.toLowerCase() !== word.toLowerCase() ? gloss : undefined,
        literal: literal && literal.toLowerCase() !== sentence.toLowerCase() ? literal : undefined,
      });
      state.mtStatus.value = '';
    } catch (err) {
      console.debug('[Sublingo] gloss failed:', err);
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
      ipa: r.entries.find((e) => e.ipa)?.ipa ?? r.lemmaEntries?.find((e) => e.ipa)?.ipa,
      lang: r.lang,
      sentence: popup.sentence || primaryCue.value?.text || '',
      translation: secondaryText.value || undefined,
      literal: popup.literal,
      definition: entries[0]?.senses[0]?.definition,
      site: 'youtube',
      videoId: this.videoId ?? '',
      title: this.title,
      time: this.player?.currentTime() ?? 0,
    });
    patchPopup({ saved: true });
  }

  private teardown() {
    this.stopDub();
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

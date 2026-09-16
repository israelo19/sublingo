// Loads the built extension into Chromium, opens a captioned French YouTube
// video, and checks that Sublingo renders dual captions and a dictionary popup.
// Usage: node scripts/smoke-youtube.mjs [videoId] [--headed]
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = process.env.SMOKE_OUT ?? path.resolve('test-results');
mkdirSync(OUT, { recursive: true });
const EXT = path.resolve('.output/chrome-mv3');
if (!existsSync(EXT)) throw new Error(`Build first: ${EXT} missing`);

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const videoIdArg = args.find((a) => !a.startsWith('--'));

const PROFILE = process.env.SMOKE_PROFILE ?? path.resolve('test-results', 'profile-' + Date.now());
const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium',
  headless: !headed,
  viewport: { width: 1280, height: 800 },
  locale: 'en-US',
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--disable-blink-features=AutomationControlled',
  ],
});

const logs = [];
const page = context.pages()[0] ?? (await context.newPage());
page.on('console', (m) => {
  const text = m.text();
  if (/sublingo|Sublingo/i.test(text) || m.type() === 'error') logs.push(`[${m.type()}] ${text.slice(0, 300)}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));
const netlog = [];
page.on('response', (r) => {
  const u = r.url();
  if (/api\/timedtext|youtubei\/v1\/player/.test(u)) {
    netlog.push(`${r.status()} ${r.request().method()} len=${r.headers()['content-length'] ?? '?'} ${u.slice(0, 200)}`);
  }
});

const report = { videoId: videoIdArg, steps: [] };
const step = (name, ok, extra = {}) => {
  report.steps.push({ name, ok, ...extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra.detail ?? ''}`);
};

try {
  let videoId = videoIdArg;
  if (!videoId) {
    await page.goto('https://www.youtube.com/results?search_query=journal+en+fran%C3%A7ais+facile&sp=EgQYAygB', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('a#video-title', { timeout: 30000 });
    // Prefer a video at least 5 minutes long so the continuity check has room to run.
    const candidates = await page.$$eval('ytd-video-renderer', (els) =>
      els.map((el) => ({
        href: el.querySelector('a#video-title')?.getAttribute('href') ?? '',
        duration: el.querySelector('ytd-thumbnail-overlay-time-status-renderer, .badge-shape-wiz__text, #time-status span')?.textContent?.trim() ?? '',
      })),
    );
    const seconds = (d) => d.split(':').reduce((acc, x) => acc * 60 + Number(x), 0);
    const pick = candidates.find((c) => c.href.startsWith('/watch?v=') && /^\d+(:\d{2}){1,2}$/.test(c.duration) && seconds(c.duration) >= 300)
      ?? candidates.find((c) => c.href.startsWith('/watch?v='));
    videoId = new URL(pick.href, 'https://www.youtube.com').searchParams.get('v');
    report.videoId = videoId;
    step('find a captioned video via search', Boolean(videoId), { detail: videoId });
  }

  await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#movie_player video', { timeout: 30000 });
  await page.evaluate(() => {
    const v = document.querySelector('video');
    if (v) {
      v.muted = true;
      void v.play();
    }
  });

  // Wait for the shadow host and for either captions or an error status.
  const host = page.locator('sublingo-overlay');
  await host.waitFor({ state: 'attached', timeout: 30000 });
  step('overlay host mounted', true);

  const outcome = await page.waitForFunction(
    () => {
      const root = document.querySelector('sublingo-overlay')?.shadowRoot;
      if (!root) return null;
      const err = root.querySelector('.sl-status-error');
      if (err) return { error: err.textContent };
      const primary = root.querySelector('.sl-primary');
      if (primary && primary.textContent.trim()) {
        return {
          primary: primary.textContent.trim(),
          secondary: root.querySelector('.sl-secondary')?.textContent?.trim() ?? '',
          badge: root.querySelector('.sl-badge')?.textContent?.trim() ?? '',
        };
      }
      return null;
    },
    null,
    { timeout: 45000 },
  ).then((h) => h.jsonValue());
  report.outcome = outcome;
  step('captions rendered', Boolean(outcome?.primary), { detail: JSON.stringify(outcome) });
  if (!outcome?.primary) {
    report.probe = await page.evaluate(async () => {
      const out = { webdriver: navigator.webdriver };
      const p = document.querySelector('#movie_player');
      const tracks = p?.getAudioTrack?.()?.captionTracks ?? [];
      const u = tracks[0]?.url || tracks[0]?.baseUrl;
      if (u) {
        for (const fmt of ['json3', 'srv3', 'none']) {
          const url = new URL(u, location.href);
          if (fmt === 'none') url.searchParams.delete('fmt'); else url.searchParams.set('fmt', fmt);
          const r = await fetch(url.toString(), { credentials: 'include' });
          out[`playerUrl_${fmt}`] = `${r.status} len=${(await r.text()).length} pot=${url.searchParams.has('pot')}`;
        }
      }
      try {
        const key = window.ytcfg?.get?.('INNERTUBE_API_KEY');
        const vid = new URLSearchParams(location.search).get('v');
        const r = await fetch(`/youtubei/v1/player?key=${key}&prettyPrint=false`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', hl: 'en' } }, videoId: vid }),
        });
        out.androidStatus = r.status;
        const j = await r.json();
        const t = j?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
        out.androidTracks = t.map((x) => `${x.languageCode}:${x.kind || 'manual'}`);
        if (t[0]?.baseUrl) {
          const url = new URL(t[0].baseUrl, location.href);
          url.searchParams.set('fmt', 'json3');
          const rr = await fetch(url.toString());
          out.androidFetch = `${rr.status} len=${(await rr.text()).length}`;
          out.androidUrl = url.toString().slice(0, 240);
        }
      } catch (e) {
        out.androidError = String(e);
      }
      try {
        p.loadModule('captions');
        p.setOption('captions', 'track', { languageCode: 'fr' });
      } catch (e) {
        out.nativeErr = String(e);
      }
      await new Promise((r) => setTimeout(r, 6000));
      out.nativeCaptionText = [...document.querySelectorAll('.ytp-caption-segment')].map((e) => e.textContent).join(' | ').slice(0, 200);
      return out;
    });
    report.diagnostics = await page.evaluate(() => {
      const p = document.querySelector('#movie_player');
      const tracks = p?.getAudioTrack?.()?.captionTracks ?? [];
      const pr = p?.getPlayerResponse?.();
      return {
        audioTrackUrls: tracks.map((t) => (t.url || t.baseUrl || '').slice(0, 200)),
        hasPotKey: Boolean(sessionStorage.getItem('iU5q-!O9@$')),
        prHasCaptions: Boolean(pr?.captions),
        prTracks: (pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).map((t) => `${t.languageCode}:${t.kind || 'manual'}`),
        captionOption: p?.getOption?.('captions', 'track'),
      };
    });
  }

  await page.screenshot({ path: path.join(OUT, 'youtube-captions.png') });

  if (outcome?.primary) {
    // Pause first: the caption must stay on screen while paused (pause-with-caption).
    await page.evaluate(() => document.querySelector('video')?.pause());
    await page.waitForTimeout(600);
    const frozen = await page.evaluate(() => document.querySelector('sublingo-overlay')?.shadowRoot?.querySelector('.sl-primary')?.textContent?.trim());
    step('caption stays on screen while paused', Boolean(frozen), { detail: frozen?.slice(0, 60) });
    await page.screenshot({ path: path.join(OUT, 'youtube-paused.png') });

    // Click the first word and wait for the dictionary popup.
    const word = host.locator('.sl-word').first();
    const wordText = await word.textContent();
    await word.click();
    const popup = host.locator('.sl-popup');
    await popup.waitFor({ timeout: 15000 });
    await page.waitForFunction(
      () => {
        const root = document.querySelector('sublingo-overlay')?.shadowRoot;
        const body = root?.querySelector('.sl-popup-body');
        return body && !/Looking up/.test(body.textContent);
      },
      null,
      { timeout: 20000 },
    );
    const popupText = (await popup.textContent()).replace(/\s+/g, ' ').trim();
    const paused = await page.evaluate(() => document.querySelector('video')?.paused);
    step('dictionary popup for first word', Boolean(popupText), { detail: `word="${wordText}" paused=${paused} :: ${popupText.slice(0, 220)}` });
    await page.screenshot({ path: path.join(OUT, 'youtube-popup.png') });

    // Save the word, then confirm it shows up on the vocabulary page later.
    const saveBtn = host.locator('.sl-btn');
    if (await saveBtn.isEnabled()) {
      await saveBtn.click();
      await host.locator('.sl-btn', { hasText: 'Saved' }).waitFor({ timeout: 5000 });
      step('save word', true, { detail: wordText });
    } else {
      step('save word', false, { detail: 'Save button disabled (no dictionary result)' });
    }
    report.savedWord = wordText;

    // Hotkey: close popup with Escape, then D for next line should change the caption.
    await page.keyboard.press('Escape');
    const before = outcome.primary;
    await page.keyboard.press('d');
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => document.querySelector('sublingo-overlay')?.shadowRoot?.querySelector('.sl-primary')?.textContent?.trim());
    step('hotkey D advances to next line', Boolean(after) && after !== before, { detail: `"${before?.slice(0, 40)}" -> "${after?.slice(0, 40)}"` });

    // Continuity: captions must keep following playback. Sample for 40 s.
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) {
        v.currentTime = 0;
        void v.play();
      }
    });
    const samples = [];
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(4000);
      samples.push(
        await page.evaluate(() => ({
          t: Math.round(document.querySelector('video')?.currentTime ?? -1),
          text: document.querySelector('sublingo-overlay')?.shadowRoot?.querySelector('.sl-primary')?.textContent?.trim().slice(0, 50) ?? '',
        })),
      );
    }
    const distinct = new Set(samples.map((s) => s.text).filter(Boolean)).size;
    const tail = samples.slice(-3).map((s) => s.text);
    const stale = tail.every((x) => x && x === tail[0]);
    const advanced = samples[samples.length - 1].t > samples[0].t + 40;
    step('captions keep tracking playback for 60 s', distinct >= 4 && !stale && advanced, {
      detail: `distinct=${distinct} advanced=${advanced} stale=${stale} :: ${samples.map((s) => `${s.t}s "${s.text.slice(0, 18)}"`).join(' | ')}`,
    });

    // Settings popup renders.
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => undefined));
    if (worker) {
      const extId = new URL(worker.url()).host;
      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extId}/popup.html`);
      await popupPage.waitForSelector('h1', { timeout: 10000 });
      const popupTitle = await popupPage.textContent('h1');
      await popupPage.setViewportSize({ width: 340, height: 520 });
      await popupPage.screenshot({ path: path.join(OUT, 'settings-popup.png') });
      step('settings popup renders', popupTitle?.trim() === 'Sublingo', { detail: popupTitle });
      await popupPage.close();

      // Dub mode: enable via extension storage, then check the overlay reports a dub source
      // and dump the raw audio-track list so the MAIN-world field mapping can be verified.
      const settingsPage = await context.newPage();
      await settingsPage.goto(`chrome-extension://${extId}/popup.html`);
      await settingsPage.evaluate(async () => {
        const cur = (await chrome.storage.local.get('settings')).settings ?? {};
        await chrome.storage.local.set({ settings: { ...cur, dubMode: true, dubProvider: 'browser' } });
      });
      await settingsPage.close();
      await page.bringToFront();
      await page.evaluate(() => {
        const v = document.querySelector('video');
        if (v) {
          v.currentTime = 12;
          void v.play();
        }
      });
      const dub = await page
        .waitForFunction(
          () => {
            const badge = document.querySelector('sublingo-overlay')?.shadowRoot?.querySelector('.sl-badge')?.textContent ?? '';
            return badge.includes('🔊') && !badge.includes('🔊 …') ? badge : null;
          },
          null,
          { timeout: 20000 },
        )
        .then((h) => h.jsonValue())
        .catch(() => null);
      const audioTracks = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const id = 'smoke-' + Date.now();
            const timer = setTimeout(() => resolve({ timeout: true }), 4000);
            document.addEventListener('sublingo:audio-tracks-result', (e) => {
              try {
                const d = JSON.parse(e.detail);
                if (d.requestId === id) {
                  clearTimeout(timer);
                  resolve(d.tracks);
                }
              } catch {}
            });
            document.dispatchEvent(new CustomEvent('sublingo:audio-tracks', { detail: JSON.stringify({ requestId: id }) }));
          }),
      );
      const rawShape = await page.evaluate(() => {
        const p = document.querySelector('#movie_player');
        const list = p?.getAvailableAudioTracks?.() ?? [];
        const first = list[0];
        return {
          count: list.length,
          methods: first ? Object.getOwnPropertyNames(Object.getPrototypeOf(first)).slice(0, 20) : [],
          keys: first ? Object.keys(first).slice(0, 20) : [],
          langInfo: first?.getLanguageInfo ? first.getLanguageInfo() : null,
          current: p?.getAudioTrack?.()?.getLanguageInfo ? p.getAudioTrack().getLanguageInfo() : null,
        };
      });
      // Sample the original volume and video rate during dense dialogue: the original audio must
      // stay ducked between consecutive lines (no full-volume leaks) and the voice must be speaking.
      const samples = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const out = [];
            const timer = setInterval(() => {
              const v = document.querySelector('video');
              const badge = document.querySelector('sublingo-overlay')?.shadowRoot?.querySelector('.sl-primary')?.textContent?.trim() ?? '';
              out.push({ t: Math.round((v?.currentTime ?? 0) * 10) / 10, vol: Math.round((v?.volume ?? 0) * 100) / 100, rate: v?.playbackRate, speaking: speechSynthesis.speaking, line: badge.slice(0, 14) });
              if (out.length >= 48) {
                clearInterval(timer);
                resolve(out);
              }
            }, 250);
          }),
      );
      const withLine = samples.filter((s) => s.line);
      const leaks = withLine.filter((s) => s.vol > 0.5).length;
      const spoke = samples.filter((s) => s.speaking).length;
      report.dub = { badge: dub, audioTracks, rawShape, samples };
      step('dub mode reports a source', Boolean(dub), { detail: `${dub} :: tracks=${JSON.stringify(audioTracks).slice(0, 200)} :: shape=${JSON.stringify(rawShape).slice(0, 300)}` });
      step('original audio stays ducked while lines are on screen', withLine.length > 10 && leaks <= Math.ceil(withLine.length * 0.1) && spoke > 5, {
        detail: `samples=${samples.length} withLine=${withLine.length} fullVolumeLeaks=${leaks} speakingSamples=${spoke} :: ${samples.slice(0, 24).map((s) => `${s.t}s v${s.vol}${s.rate !== 1 ? ` r${s.rate}` : ''}${s.speaking ? ' S' : ''}`).join(' | ')}`,
      });
      await page.screenshot({ path: path.join(OUT, 'youtube-dub.png') });

      const vocabPage = await context.newPage();
      await vocabPage.goto(`chrome-extension://${extId}/vocab.html`);
      await vocabPage.waitForSelector('h1', { timeout: 10000 });
      await vocabPage.waitForTimeout(500);
      const words = await vocabPage.$$eval('.word', (els) => els.map((e) => e.textContent?.trim().toLowerCase()));
      await vocabPage.setViewportSize({ width: 900, height: 700 });
      await vocabPage.screenshot({ path: path.join(OUT, 'vocab-page.png') });
      step('vocab page lists the saved word', words.includes((report.savedWord ?? '').toLowerCase()), { detail: JSON.stringify(words) });
      await vocabPage.close();
    }
  }
} catch (err) {
  step('smoke run', false, { detail: String(err).slice(0, 900) });
  await page.screenshot({ path: path.join(OUT, 'youtube-failure.png') }).catch(() => undefined);
} finally {
  report.logs = logs.slice(0, 40);
  report.network = netlog.slice(0, 30);
  console.log(JSON.stringify(report, null, 2));
  await context.close();
}

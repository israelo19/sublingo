// Opens a video known for many dubbed audio tracks and dumps YouTube's audio-track API shape,
// then asks the Sublingo MAIN-world bridge to list and switch tracks.
import { chromium } from 'playwright';
import path from 'node:path';
const EXT = path.resolve('.output/chrome-mv3');
const query = process.argv[2] ?? 'MrBeast';
const wantLang = process.argv[3] ?? 'fr';
const context = await chromium.launchPersistentContext(path.resolve('test-results', 'profile-probe-' + Date.now()), {
  channel: 'chromium', headless: false, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-blink-features=AutomationControlled'],
});
const page = context.pages()[0] ?? (await context.newPage());
try {
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('a#video-title', { timeout: 30000 });
  const href = await page.$$eval('a#video-title', (as) => as.map((a) => a.getAttribute('href')).find((h) => h?.startsWith('/watch?v=')));
  await page.goto(new URL(href, 'https://www.youtube.com').toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#movie_player video', { timeout: 30000 });
  await page.evaluate(() => { const v = document.querySelector('video'); if (v) { v.muted = true; void v.play(); } });
  await page.waitForTimeout(8000);
  const shape = await page.evaluate(() => {
    const p = document.querySelector('#movie_player');
    const list = p?.getAvailableAudioTracks?.() ?? [];
    const cur = p?.getAudioTrack?.();
    const info = (t) => (t?.getLanguageInfo ? t.getLanguageInfo() : null);
    return {
      title: p?.getVideoData?.()?.title,
      count: list.length,
      tracks: list.slice(0, 12).map((t) => ({ id: t.id, keys: Object.keys(t).slice(0, 8), info: info(t) })),
      current: info(cur),
    };
  });
  console.log('SHAPE', JSON.stringify(shape, null, 1));
  const bridge = await page.evaluate(
    (lang) =>
      new Promise((resolve) => {
        const ask = (ev, res, payload) =>
          new Promise((r) => {
            const id = 'probe-' + Math.random();
            const timer = setTimeout(() => r({ timeout: true }), 5000);
            document.addEventListener(res, (e) => {
              try { const d = JSON.parse(e.detail); if (d.requestId === id) { clearTimeout(timer); r(d); } } catch {}
            });
            document.dispatchEvent(new CustomEvent(ev, { detail: JSON.stringify({ requestId: id, ...payload }) }));
          });
        (async () => {
          const list = await ask('sublingo:audio-tracks', 'sublingo:audio-tracks-result', {});
          const match = list.tracks?.find((t) => t.lang === lang);
          let set = null; let after = null;
          if (match) {
            set = await ask('sublingo:set-audio-track', 'sublingo:set-audio-track-result', { id: match.id });
            await new Promise((r) => setTimeout(r, 2500));
            after = document.querySelector('#movie_player')?.getAudioTrack?.()?.getLanguageInfo?.();
          }
          resolve({ listed: list.tracks?.map((t) => `${t.lang}:${t.name}${t.current ? '*' : ''}${t.kind ? ` (${t.kind})` : ''}`), match: match?.name, set, after });
        })();
      }),
    wantLang,
  );
  console.log('BRIDGE', JSON.stringify(bridge, null, 1));
} catch (err) {
  console.log('PROBE ERROR', String(err).slice(0, 400));
} finally {
  await context.close();
}

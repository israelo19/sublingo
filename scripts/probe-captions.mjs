// Watches the caption lines Sublingo renders on a video for a while and reports CC artifacts
// (">>", leading dashes, speaker labels) and fragment-looking lines. Usage:
//   node scripts/probe-captions.mjs <videoId | search query> [seconds]
import { chromium } from 'playwright';
import path from 'node:path';
const EXT = path.resolve('.output/chrome-mv3');
const target = process.argv[2] ?? 'NBA press conference';
const seconds = Number(process.argv[3] ?? 40);
const context = await chromium.launchPersistentContext(path.resolve('test-results', 'profile-captions-' + Date.now()), {
  channel: 'chromium', headless: false, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-blink-features=AutomationControlled'],
});
const page = context.pages()[0] ?? (await context.newPage());
try {
  let videoId = /^[\w-]{11}$/.test(target) ? target : null;
  if (!videoId) {
    await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(target)}&sp=EgIoAQ%253D%253D`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('a#video-title', { timeout: 30000 });
    const href = await page.$$eval('a#video-title', (as) => as.map((a) => a.getAttribute('href')).find((h) => h?.startsWith('/watch?v=')));
    videoId = new URL(href, 'https://www.youtube.com').searchParams.get('v');
  }
  await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#movie_player video', { timeout: 30000 });
  await page.evaluate(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.currentTime = 20; void v.play(); } });
  try {
    await page.waitForFunction(() => document.querySelector('sublingo-overlay')?.shadowRoot?.querySelector('.sl-primary, .sl-status-error'), null, { timeout: 60000 });
  } catch {
    const status = await page.evaluate(() => ({
      status: document.querySelector('sublingo-overlay')?.shadowRoot?.querySelector('.sl-status')?.textContent ?? '(no status)',
      badge: document.querySelector('sublingo-overlay')?.shadowRoot?.querySelector('.sl-badge')?.textContent ?? '',
      title: document.title,
      time: document.querySelector('video')?.currentTime,
      ad: Boolean(document.querySelector('#movie_player.ad-showing')),
    }));
    console.log('NO CAPTIONS RENDERED', JSON.stringify(status));
    throw new Error('no captions rendered');
  }
  const seen = new Map();
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const cur = await page.evaluate(() => {
      const root = document.querySelector('sublingo-overlay')?.shadowRoot;
      return {
        t: Math.round(document.querySelector('video')?.currentTime ?? 0),
        primary: root?.querySelector('.sl-primary')?.textContent?.trim() ?? '',
        secondary: root?.querySelector('.sl-secondary')?.textContent?.trim() ?? '',
        badge: root?.querySelector('.sl-badge')?.textContent?.trim() ?? '',
        error: root?.querySelector('.sl-status-error')?.textContent?.trim() ?? '',
      };
    });
    if (cur.error) { console.log('ERROR', cur.error); break; }
    const key = cur.primary + '|' + cur.secondary;
    if (cur.primary && !seen.has(key)) seen.set(key, cur);
    await page.waitForTimeout(500);
  }
  const lines = [...seen.values()];
  const artifacts = lines.filter((l) => /(^|\s)>>|^\s*-\s|^[A-Z][A-Z .'-]{1,20}:\s/.test(l.primary) || /(^|\s)>>|^\s*-\s|^[A-Z][A-Z .'-]{1,20}:\s/.test(l.secondary));
  const avgLen = lines.length ? Math.round(lines.reduce((a, l) => a + l.primary.length, 0) / lines.length) : 0;
  console.log(JSON.stringify({ videoId, badge: lines[0]?.badge, distinctLines: lines.length, avgPrimaryChars: avgLen, artifactLines: artifacts.length, sample: lines.slice(0, 8).map((l) => `${l.t}s | ${l.primary.slice(0, 70)} || ${l.secondary.slice(0, 60)}`) }, null, 1));
} catch (err) {
  console.log('PROBE ERROR', String(err).slice(0, 300));
} finally {
  await context.close();
}

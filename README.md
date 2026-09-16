# Sublingo

Learn a language by watching. Sublingo is a free, open-source browser extension
that overlays dual subtitles on video sites, lets you click any word for an
instant dictionary entry, keeps the caption on screen when you pause, and saves
the words you look up.

Built as a no-cost alternative to RemFluent and Language Reactor. Everything
runs locally in your browser: no account, no server, no subscription.

**Status:** early. YouTube works, including saved words, Anki export, and
Chrome's on-device translation. Hulu, Netflix, and Disney+ are next (see
`docs/PLAN.md`).

## Install (unpacked, Chrome)

```bash
npm install
npm run build          # writes .output/chrome-mv3
```

1. Open `chrome://extensions`, turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the `.output/chrome-mv3` folder.
3. Open any YouTube video that has captions in the language you are learning.
   French is the default; change languages from the extension's toolbar popup.

`npm run dev` starts WXT in watch mode and launches a Chrome profile with the
extension pre-loaded, rebuilding on every save.

## Using it

- **Two lines under the video.** Top: the language you are learning. Bottom: your
  language. If the video has no human track in your language, YouTube's free
  auto-translation is used and the badge says `MT`.
- **Cleaner than broadcast captions.** Speaker-change markers (`>>`), stray dashes,
  and HTML entities are removed, and fragments that break mid-sentence are joined
  into sentence-sized lines (setting: "Join caption fragments into sentences").
  When the top line is machine-translated, Sublingo translates whole sentences
  with Chrome's on-device translator instead of YouTube's fragment-by-fragment
  output, so the French reads naturally and lines up with the English.
- **Click any word** in the top line for lemma, part of speech, IPA, and English
  definitions from Wiktionary. The video pauses while you read (configurable).
- **Pause** and the current line stays on screen.
- **Save word** stores the word, its sentence, the translation line, IPA, and the
  video timestamp locally. Open **Saved words** from the toolbar popup to search
  them, jump back to the exact second in the video, export a CSV, or send new
  words straight to Anki (needs Anki open with the
  [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on; the note type
  and deck are created for you).
- **On-device translation.** With Chrome 138+ the dictionary card also shows a
  quick gloss of the word and a literal translation of the whole line, produced by
  Chrome's built-in translator with nothing sent to any server. When a video has no
  translation track at all, that same translator supplies the second line.
- **Hover to pause** (optional): the video pauses while your pointer is over the
  caption box and resumes when you move away.
- **Layout:** text size and caption height are adjustable from the popup.
- **Dub mode (hear it in French).** Turn on "Listen in French" in the popup (hotkey
  `V`). If the video already has a French audio track (YouTube auto-dubs many
  videos), Sublingo switches to it: perfect sync, music intact. Otherwise a voice
  reads each French line in time with the video while the original audio is
  turned down, so music and ambience still come through. The voice is Azure's
  neural voice when you add a key (free tier, see below), and your browser's
  built-in voice otherwise.

### Azure voice setup (free tier, about ten hours of speech a month)

1. Sign in at https://portal.azure.com and choose **Create a resource**.
2. Search for **Speech** (Azure AI services) and click **Create**.
3. Pick your subscription, create a resource group (for example `sublingo`),
   choose a region near you such as `eastus`, and select the **Free F0** pricing
   tier. Click **Review + create**, then **Create**.
4. Open the resource and go to **Keys and Endpoint**. Copy **Key 1** and note the
   **Region**.
5. In the Sublingo popup, turn on **Listen in French**, expand **Azure neural
   voice**, paste the key, pick the region, click **Load voices** and choose one,
   then **Test voice**.

The key is stored only in your browser's extension storage. The free tier allows
20 requests a minute, which fits normal speech; very fast dialogue falls back to
the browser voice for the lines Azure can't deliver in time. Each line is cached,
so replaying a video costs nothing.

Hotkeys (ignored while typing in a text field):

| Key | Action |
|---|---|
| `A` | Previous line |
| `S` | Replay current line |
| `D` | Next line |
| `Q` | Toggle pause-after-every-line |
| `W` | Toggle the translation line |
| `V` | Toggle dub mode (listen in the language you're learning) |
| `Esc` | Close the dictionary popup |

## Privacy and permissions

Sublingo has no server, no account, and no analytics. Everything runs in your browser.

| Data | Where it goes |
|---|---|
| Captions | Downloaded from the video site you are already on, kept in memory. |
| Words you click | Sent to Wiktionary (via freedictionaryapi.com and en.wiktionary.org) to fetch the definition. Cached locally. |
| Literal translations and glosses | Chrome's built-in translator, on your device. Nothing leaves the browser. |
| Saved words | `chrome.storage.local` on this device. Export is a file you download or a push to your local Anki. |
| Dub mode, YouTube track | A player setting on the page, nothing sent anywhere. |
| Dub mode, browser voice | Your operating system's speech engine. |
| Dub mode, Azure voice | The French caption text is sent to Azure Speech in the region you chose, using your own key. Clips are cached locally so each line is sent once. |
| Azure key | `chrome.storage.local` on this device only. It is never synced and never logged. |

Permissions requested and why:

- `storage`, `unlimitedStorage`: settings, saved words, dictionary and audio caches.
- `freedictionaryapi.com`, `en.wiktionary.org`: dictionary lookups from the background worker.
- `127.0.0.1:8765`, `localhost:8765`: AnkiConnect, only when you click "Send to Anki".
- `*.tts.speech.microsoft.com`: Azure text-to-speech, only when you configure a key.
- Content scripts run only on `www.youtube.com`.

Hardening in the code: caption downloads are restricted to YouTube's own caption endpoint,
dictionary links are limited to http(s), CSV exports neutralize spreadsheet formulas, and the
background worker validates every message it receives. Dependencies are pinned through
`package-lock.json`; `npm audit` reports no known vulnerabilities as of 2026-09-16.

## Develop

```bash
npm test               # unit tests (vitest)
npm run typecheck
npm run build
node scripts/smoke-youtube.mjs --headed   # loads the build into Chromium and checks a real video
node scripts/probe-audio-tracks.mjs MrBeast fr   # dumps YouTube's audio-track API and tests switching
```

The smoke test must run headed: YouTube serves empty caption tracks to headless
Chromium, so a headless run always fails at "captions rendered".

Stack: [WXT](https://wxt.dev) (Manifest V3), TypeScript, Preact, Vitest, Playwright for the
smoke test.

Layout: `src/entrypoints` holds the background worker, the YouTube content scripts (one in
the page's MAIN world for player and caption access, one isolated for the UI), the popup, and
the saved-words page. `src/lib` holds pure, unit-tested modules: subtitle parsers and cue
timing, tokenizer, dictionary providers and lemma detection, Chrome translation, Anki export,
Azure and browser text-to-speech, and the dub scheduler. `docs/PLAN.md` is the research,
decisions, and phase log.

## License

MIT. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.

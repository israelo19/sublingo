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

## Develop

```bash
npm test               # unit tests (vitest)
npm run typecheck
npm run build
node scripts/smoke-youtube.mjs --headed   # loads the build into Chromium and checks a real video
```

The smoke test must run headed: YouTube serves empty caption tracks to headless
Chromium, so a headless run always fails at "captions rendered".

Stack: [WXT](https://wxt.dev) (Manifest V3), TypeScript, Preact, Vitest.

## License

MIT. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.

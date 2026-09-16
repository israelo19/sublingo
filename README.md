# Sublingo

Learn a language by watching. Sublingo is a free, open-source browser extension
that overlays dual subtitles on video sites, lets you click any word for an
instant dictionary entry, keeps the caption on screen when you pause, and saves
the words you look up.

Built as a no-cost alternative to RemFluent and Language Reactor. Everything
runs locally in your browser: no account, no server, no subscription.

**Status:** early. YouTube works. Hulu, Netflix, and Disney+ are next
(see `docs/PLAN.md`).

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
- **Save word** stores the word, its sentence, the translation line, and the
  video timestamp locally. Export to Anki is coming in the next phase.

Hotkeys (ignored while typing in a text field):

| Key | Action |
|---|---|
| `A` | Previous line |
| `S` | Replay current line |
| `D` | Next line |
| `Q` | Toggle pause-after-every-line |
| `W` | Toggle the translation line |
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

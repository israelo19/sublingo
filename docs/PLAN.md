# Sublingo: open-source RemFluent clone, research and build plan

Status: APPROVED 2026-09-15 with changes (platform order, name, license, git rules).
Build status: Phase 0 and Phase 1 (YouTube MVP) implemented and passing the headed smoke test on 2026-09-15. Awaiting your hands-on try before Phase 2.
Date: 2026-09-15

---

## 1. What RemFluent actually is

RemFluent is a paid Chrome extension plus web app by a solo developer (Younes Aissaoui, Algeria).
Extension v1.5.1, last updated 2026-09-10, about 5,000 users, only 58 KiB. The small size means
the extension is a thin client; the real work happens on their servers.

**Feature set (from remfluent.com and the Chrome Web Store listing)**

| Area | What it does |
|---|---|
| Netflix and Disney+ extension | Overlays dual subtitles (original + translation) inside the player. Tap any word for meaning, pronunciation, grammar. |
| Languages | 17, including French. Furigana/romaji for Japanese, pinyin for Chinese. |
| Web app | Paste a YouTube link or drop a local video file, get synced dual subtitles. |
| Anki | Generates flashcard decks from what you watched (web app only, metered by "credits"). |
| Download | Pro users can download the generated subtitles. |

**Pricing**

| Tier | Price | Limits |
|---|---|---|
| Free | $0 | 2 demo episodes on Netflix and Disney+ |
| Pro Pink | $9/mo | 60 h/mo "media processing", 500 Anki credits, 7-day storage |
| Pro Glow | $16/mo | 120 h/mo processing, 1,000 Anki credits, permanent storage |

"Media processing hours" is the tell: they run speech-to-text and machine translation on their
servers, which is why they can promise captions "across all audio language options" even when
the platform has no subtitle track. That is the expensive part we replace with free, local
alternatives (see section 3).

**Known weaknesses called out by reviewers**: Netflix and Disney+ only (no YouTube in-browser),
Chrome only, no spaced-repetition review system, and zero Chrome Web Store ratings.

## 2. Landscape: who else does this

| Product | Model | Notes |
|---|---|---|
| Language Reactor | Freemium | The gold standard UI. Netflix + YouTube. Dual subs, hover dictionary, auto-pause, saved words, hotkeys (A/S/D prev/replay/next, Q auto-pause). Netflix integration broke 2026-06-30 and has been flaky since. |
| Lingopie | Paid | Own content library plus Netflix. Mobile and TV apps. |
| Migaku | Paid, no free tier | Sentence-mining flashcards. Heavy setup. |
| Trancy, FluentAI, DeepLingo | Paid | Newer clones; some add Prime/HBO, AI coach, CEFR levels. |
| **asbplayer** | MIT, open source | Actively maintained (v1.20.2 on 2026-08-22). Netflix, YouTube, Disney+, Hulu, Prime. Anki via AnkiConnect. No built-in popup dictionary (relies on Yomitan). Built with WXT. **Best prior art; we borrow its site adapters.** |
| subadub, NflxMultiSubs/seeingdouble, yt-dual-sub, dual-captions | Open source | Older single-purpose Netflix/YouTube dual-sub extensions. Useful for parsing code, mostly stale. |

Nothing open source combines dual subtitles + click-to-define + pause-with-caption + vocabulary
saving in one polished package. That gap is the project.

## 3. Technical findings (the parts that decide feasibility)

### 3.1 Netflix subtitles: the June 2026 change and the working approach

On 2026-06-30 Netflix moved the manifest call to `licensedManifest` and stopped exposing timed-text
URLs in the intercepted JSON. The classic technique (hook `JSON.parse`, look for
`timedtexttracks`, inject the `webvtt-lssdh-ios8` profile via `JSON.stringify`) broke for
Language Reactor and most downloaders.

asbplayer shipped a fix within a week. Instead of intercepting network JSON, it talks to Netflix's
own in-page player API from a MAIN-world script:

```
netflix.appContext.state.playerApp.getAPI().videoPlayer
  .getAllPlayerSessionIds()            -> take the last one
  .getVideoPlayerBySessionId(id)       -> player
player.getMovieId()
player.getTimedTextTrackList()         -> tracks {trackId, bcp47, displayName, rawTrackType,
                                          isNoneTrack, isForcedNarrative, isImageBased}
player.getTimedTextTrack() / setTimedTextTrack(track)
player.seek(ms) / play() / pause()
```

Subtitle download URLs are read by walking the player state tree
(`playerApp.getState().videoPlayer.cadmiumPlayerRepository.playersById[sessionId]`) for objects
shaped `{type: 'timedtext', trackId, urls: [{url}]}`. To get a second language that Netflix has
not fetched yet: temporarily `setTimedTextTrack(track)`, poll until its URL appears, then revert.
Files on this path are IMSC 1.1 (TTML XML), so we need a TTML parser, not just WebVTT.

This is structural matching rather than minified-property-path matching, so it survives most
Netflix deploys. The legacy JSON hook stays in the codebase as a fallback only.

### 3.2 Disney+

HLS. Hook `fetch`/XHR in the MAIN world, catch the master `.m3u8`, parse `#EXT-X-MEDIA:TYPE=SUBTITLES`
entries (NAME, LANGUAGE, FORCED, CHARACTERISTICS), fetch the media playlist, then fetch and
concatenate the segmented WebVTT using each segment's `X-TIMESTAMP-MAP` offset. Disney exposes a
player object with `seek(ms)/play()/pause()` for control. asbplayer's `disney-plus-page.ts` and
`m3u8-util.ts` are the reference.

### 3.3 YouTube

Since 2025 YouTube requires a Proof-of-Origin token (`pot`) on `/api/timedtext`; without it you
get an empty 200. Working approach (asbplayer): in the MAIN world read
`player.getAudioTrack().captionTracks` (URLs already carry `pot`), or decode the token from
YouTube's sessionStorage and append `&pot=...&c=WEB` to the `captionTracks[].baseUrl` from the
player response. Fetch `fmt=json3`. YouTube also serves free auto-translated tracks via `tlang=`.

### 3.3b Hulu

Simplest of the four. Hook `window.fetch` in the MAIN world, catch responses from
`play.hulu.com/v6/playlist`, and read `transcripts_urls.webvtt`, a map of language code to a
plain WebVTT URL. Player control goes through the page's `<video>` element. Reference:
asbplayer `hulu-page.ts`. Hulu is US-only, which is fine here.

### 3.4 Translation, for free

- **Chrome built-in Translator API** (Chrome 138+; you are on Chrome 152). On-device, no key, no
  quota, fr<->en supported. `Translator.create()` needs a user gesture; translations run
  sequentially. Not available in workers, so it runs in a window context (content script,
  offscreen document, or side panel).
- For Netflix the "translation" line is usually just the platform's own human-written English
  track, which is better than machine translation. MT is only for literal word/phrase glosses or
  when a second track is missing.
- The unofficial Google endpoint (`translate_a/single?client=gtx`) is now blocked with 429s
  (as of 2026-09-14). Do not depend on it.

### 3.5 Dictionary, for free (verified today with live requests)

| Source | Result for `manger` / `mangeait` | Notes |
|---|---|---|
| Wiktionary REST `en.wiktionary.org/api/rest_v1/page/definition/{word}` | FR verb "to eat", noun "food"; `mangeait` returns "third-person singular imperfect indicative of manger" with a link to the lemma | CORS `*`, HTML inside definitions (strip it), CC BY-SA |
| freedictionaryapi.com `/api/v1/entries/fr/{word}` | POS, IPA `/mɑ̃.ʒe/`, senses, 64 inflected forms | Clean JSON, 1,000 req/h/IP, translations empty for FR |

Plan: Wiktionary REST as primary, freedictionaryapi as secondary, cache everything in IndexedDB.
Resolve lemmas by parsing "form of X" definitions; optionally add `node-lefff` (French LEFFF
lexicon) for offline lemmatization. A fully offline dictionary pack built from kaikki.org
wiktextract data (about 390k French forms) is a later optimization, not an MVP need.

### 3.6 AI explanations and speech-to-text, for free

- **Chrome Prompt API** (Gemini Nano, on-device, extensions only, Chrome 138+; French supported
  from Chrome 149) for "explain this grammar" or "why this word here". Zero cost.
- Optional bring-your-own Claude API key for higher quality. Note: a Claude Max subscription does
  **not** include API credits; the API is pay-as-you-go. Default off.
- **Whisper in the browser** via transformers.js with WebGPU: 1 to 3x real time, models 75 MB to
  1.5 GB cached in IndexedDB. This is our free replacement for RemFluent's metered "processing
  hours" when a local file or video has no subtitle track.

### 3.7 Framework

**WXT** (Vite-based, Manifest V3, cross-browser, file-based entrypoints, `defineUnlistedScript`
for MAIN-world scripts). It is the 2026 consensus pick and what asbplayer uses, which makes
porting their adapters straightforward. TypeScript throughout. Preact for the overlay UI inside a
Shadow DOM so Netflix CSS cannot leak in. Vitest for parser and alignment tests.

## 4. Product definition (v1)

**Target user**: English speaker learning French (you). Language pair is a setting, not a
hard-code, but French/English is what gets tested first.

**Platform order (decided)**: 1. YouTube, 2. Hulu, 3. Netflix, 4. Disney+. YouTube first because it
is what you watch most; Disney+ last because there is no active subscription to test against.

**Core loop while watching (YouTube first, same on every platform)**

1. Open any video. Extension detects the player, lists available text tracks.
2. Overlay shows two lines under the video: French (primary, tokenized into clickable words)
   and English (secondary, dimmed, optionally blurred until hover).
3. Pause: the current caption stays on screen. The platform's native captions are hidden so there
   is no double display.
   On YouTube the secondary line can come from a human English track or from YouTube's free
   auto-translation (`tlang=en`) when none exists.
4. Click a word: popup with lemma, part of speech, IPA, English definitions, the word in the
   current sentence, and a literal machine translation of the sentence. Save button.
5. Hotkeys: Space play/pause, A previous line, S replay line, D next line, Q toggle auto-pause
   at end of each line, W toggle secondary line, H hover-to-pause on/off. All rebindable.
6. Saved words land in a local vocabulary list with the sentence, title, and timestamp.
   Export as CSV or straight into Anki via AnkiConnect.

**Explicitly out of v1**: accounts, sync, mobile, TV, furigana/pinyin, server-side anything.

## 5. Architecture

```
extension/
  entrypoints/
    background.ts            service worker: settings, dictionary fetch + cache, vocab store
    offscreen/               hosts Chrome Translator + Prompt API sessions if content scripts cannot
    youtube.content.ts       isolated world: mounts overlay, wires player adapter
    youtube-main.ts          MAIN world: caption tracks + PoToken bridge (section 3.3)
    hulu.content.ts / hulu-main.ts            (phase 3)
    netflix.content.ts / netflix-main.ts      (phase 3, section 3.1)
    disney.content.ts / disney-main.ts        (phase 3)
    popup/                   quick toggles: on/off, languages, secondary visibility
    options/                 full settings, hotkeys, dictionary/translation providers, export
    vocab/                   saved words page
  lib/
    subtitles/               parsers: WebVTT, TTML/IMSC 1.1, YouTube json3, SRT; cue model;
                             alignment (pair primary/secondary cues by time overlap)
    player/                  PlayerAdapter interface: currentTime, seek, play, pause, onTime,
                             listTracks, loadTrack(lang); Netflix, Disney, YouTube, generic <video>
    overlay/                 Preact UI in Shadow DOM: dual caption box, word popup, mini toolbar
    dictionary/              providers (Wiktionary REST, FreeDictionaryAPI), lemma resolver, cache
    translate/               Chrome Translator provider; "none" fallback
    ai/                      Chrome Prompt API provider; optional Claude API provider
    vocab/                   IndexedDB store, CSV export, AnkiConnect client
    hotkeys/
webapp/                      (phase 4) local files + YouTube links, Whisper WebGPU
```

Messaging: MAIN-world script <-> content script via `CustomEvent` on `document` (same pattern as
asbplayer); content script <-> background via `chrome.runtime` messages.

## 6. Phased build

**Phase 0: Spike** — DONE 2026-09-15.
Prove the riskiest YouTube assumption before any UI. WXT skeleton, load unpacked, open a
French YouTube video, and from the MAIN-world script: read caption tracks with their `pot`
parameter, fetch a French track and an English (or auto-translated) track as json3, parse to
cues, log the active cue pair as `currentTime` advances.
Exit criteria: cue pairs printed in sync for one full minute.

**Phase 1: YouTube MVP** — BUILT 2026-09-15, verified by `scripts/smoke-youtube.mjs --headed` (captions, pause-persist, popup, hotkeys, settings). Not yet tried by hand.
Overlay with dual captions, native caption hiding, pause-persist, A/S/D/Space hotkeys, click word
-> Wiktionary popup (lemma, POS, IPA, definitions), settings popup for language pair and
secondary visibility. Unit tests for json3/VTT parsers and alignment against fixture files.
Exit criteria: watch a full French YouTube video using only this extension.

**Phase 2: Vocabulary and translation** — BUILT 2026-09-16 (vocab page, CSV and AnkiConnect export, Chrome on-device translation for glosses and literal lines, hover-to-pause, caption height control, icons). Awaiting your hands-on try.
Save words with context, vocab page, CSV and AnkiConnect export. Chrome Translator API for
literal sentence translation and word-in-context gloss. Auto-pause (Q), hover-to-pause, blur
secondary until hover, font size and position controls.

**Phase 3: Hulu, then Netflix, then Disney+ adapters**
Hulu: fetch hook on `/v6/playlist` (section 3.3b). Netflix: in-page player API and IMSC parser
(section 3.1). Disney+: HLS playlist and segmented WebVTT (section 3.2), tested once a
subscription is active. Generic `<video>` adapter for any page with a subtitle file you supply.

**Phase 4: Web app for local files and YouTube links**
Drop a video plus SRT/VTT, or a video alone and run Whisper WebGPU to generate cues. Same overlay
and dictionary code, different player adapter. Prompt API "explain this line" button.

**Phase 5: Open-source release**
MIT license, README with GIF, CONTRIBUTING, GitHub Actions (typecheck + Vitest + build zip),
Firefox build (Translator API absent there, so translation degrades to "off"), decision on Chrome
Web Store publishing versus unpacked install only. Publishing happens only when you say so.

## 6.1 Things learned while building Phase 1

- **YouTube's proof-of-origin token.** The player's own caption URLs carry a valid `pot` a few
  seconds after load. We poll for it for up to 15 s, nudge the captions module once at 1.5 s if
  it has not appeared, capture the player's own `/api/timedtext` requests through the
  Performance API and fetch/XHR hooks, and retry an empty download with backoff. Cached
  sessionStorage tokens are the last resort.
- **Headless Chromium gets empty captions.** Even YouTube's own caption requests return
  empty bodies under headless automation, so the smoke test must run headed. Real Chrome is fine.
- **WXT resets the shadow host.** `createShadowRootUi` injects `:host { all: initial !important }`.
  Inside a shadow tree an important rule beats anything the page sets on the host, including
  inline `!important`, so the host box must be styled from our own shadow stylesheet with a
  more specific `:host(sublingo-overlay)` rule.
- **Bug run 1 (2026-09-15): captions froze after ~20 s while the video played on.** Root
  cause addressed: the player adapter captured one `<video>` element at mount time, and
  YouTube swaps that element (around ads and preloaded videos), leaving us reading a dead
  element's frozen `currentTime`. The adapter now re-resolves the live element on every
  100 ms tick and rebinds its listeners. The smoke test gained a 60-second continuity check
  on a 10-minute video with auto-generated captions, which passes.
- **Dictionary quality is good for French.** freedictionaryapi.com resolved `apprenez` to
  `apprendre` with IPA and glosses on the first live click. Wiktionary REST is the fallback.

## 6.2 Proposed Phase 2.5: Dub mode ("hear it in French")

Idea from your roommate: watch an English video but hear French, kept in sync. Researched
2026-09-16. Four tiers, cheapest first; the plan is to build tiers 0 and 1 (both free),
and offer tier 3 as an optional bring-your-own-key upgrade.

| Tier | How | Cost | Quality | Sync |
|---|---|---|---|---|
| 0. YouTube's own dub | YouTube auto-dubs uploads into 27 languages including French, with "Expressive Speech" for French since early 2026, and it is on for every creator who enables advanced features. The player exposes `getAvailableAudioTracks()` / `setAudioTrack()` on `#movie_player`. Sublingo adds a "Listen in French when available" setting and switches the audio track automatically. | $0 | Best available: a real dub with matched pacing and intonation | Perfect, it is the video's own audio |
| 1. On-device browser TTS | Web Speech API (`speechSynthesis`) reads each French caption line at its start. macOS ships French voices (Thomas, Amélie, Audrey; Siri voices if installed). Original audio is ducked to ~15% while a line is spoken, restored in gaps. | $0 | Fair to good on macOS, robotic on some Windows voices | Good: each line starts on cue; rate auto-fits long lines; falls back to trimming |
| 2. Kokoro-82M in the browser | Neural TTS via WebGPU (transformers.js / kokoro-js), French supported, ~300 MB one-time download. Pre-generate audio per cue ahead of playback. | $0 | Good, clearly better than tier 1 | Good, and exact clip durations are known in advance so pacing can be planned |
| 3. Cloud TTS, BYO key | Azure Neural TTS: 500k characters/month free forever (~10 h of speech), plus your $10k Azure credit. OpenAI gpt-4o-mini-tts: ~$0.015/min, so your $1,000 credit covers ~1,100 hours. Deepgram Aura-2 speaks French at $0.03/1k chars. ElevenLabs: best voices but only 10k chars/month free (~10 min) and not in your YC list. | $0 within free tiers/credits | Excellent | Same as tier 2 |

**Important side-finding.** YouTube picks the dub matching your interface language by
default. With an English UI, a French video may already be playing an *English* auto-dub
(the RFI test video showed an "Auto-dubbed" badge). Tier 0 therefore has two jobs: for French
videos, force the original French audio; for English videos, pick the French dub when one
exists.

**Sync design for tiers 1 to 3.** At each cue start, play that cue's audio. If the clip is
longer than the cue window, speed it up to at most 1.25x; if still longer, slow the video to
0.85x until the clip ends, then restore. Original audio ducks while a clip plays. French
captions stay on screen so the dub is readable as well as audible. Kokoro's non-English
phonemization needs a spike (the browser port relies on an external phonemizer for French).

Recommendation: build tier 0 first (small, free, highest quality), then tier 1 as the fallback
for videos without a French dub, then decide on tiers 2 and 3 based on how tier 1 sounds to you.

## 7. Risks and how the plan handles them

| Risk | Mitigation |
|---|---|
| Netflix changes player internals again | Structural matching, adapter isolated behind an interface, a smoke-test checklist per adapter, and the legacy JSON hook as fallback. asbplayer is a canary: if they break, we will too, and their fix is MIT. |
| Terms of service | We read subtitle data already delivered to the browser and never touch DRM or video bytes, the same category as Language Reactor and asbplayer. Do not publish to the Chrome Web Store until you decide you want that exposure. |
| Dictionary API rate limits | Aggressive IndexedDB cache; two providers; offline pack later. |
| Translator API needs a user gesture | Create the translator on the first click/keypress in the overlay and keep it alive. |
| Testing Hulu and Netflix needs a logged-in session | I cannot enter your credentials. You log in once in Chrome; I then drive the tab through the Claude in Chrome extension to test the overlay. YouTube needs no login, so I test it myself in a Playwright-launched Chromium with the extension loaded. |

## 8. Decisions (resolved 2026-09-15)

| Question | Decision |
|---|---|
| Scope and order | YouTube, then Hulu, then Netflix, then Disney+ |
| Stack | WXT + TypeScript + Preact + Vitest. All free and MIT/Apache licensed. |
| Dictionary | Online Wiktionary with caching for v1, offline pack later |
| AI features | Chrome Prompt API by default. Optional Claude API key, which can draw on the $500 YC Anthropic credit. Off by default. |
| License | MIT |
| Name | **Sublingo** (check for trademark and Chrome Web Store name conflicts before any publishing) |
| Cost rule | Zero spend. Free tiers only. If something is discounted rather than free, use the free alternative. |
| Git rules | No pushes to GitHub unless you explicitly ask. Commits and pushes only under your identity (Israel Ogwu), never with Claude attribution. You want to try the build yourself first. |

### 8.1 YC AI Stack deals evaluated against this plan

The plan already runs at $0 with no servers, so almost none of the 24 deals change anything.
Only the ones below are worth wiring in, all as optional providers that default off.

| Deal | Verdict | Where it fits |
|---|---|---|
| Anthropic $500 credits | Useful, optional | Higher-quality "explain this line" than Gemini Nano (phase 4). Credits, not the Max subscription, pay for API calls. |
| OpenAI $1,000 credits | Marginal, optional | Whisper API as a faster fallback to local WebGPU Whisper for long local files (phase 4). Needs the YC verification link first. |
| Deepgram | Marginal, optional | Same role as OpenAI Whisper: cloud speech-to-text fallback. Local Whisper stays the default because it is free forever. |
| Greptile 1 year free | Useful later | Free AI code review on pull requests once the repo is public (phase 5). |
| Supabase $300 | Not now | Only if you later want vocab sync across devices. v1 stores everything locally. |
| Azure, AWS, Google credits | Not needed | No backend. The phase 4 web app is static and can sit on GitHub Pages for free. |
| Firecrawl, Blaxel, Browser Use, Gumloop, Roboflow, Langfuse, Vapi, Bolna, Tavus, sync., Sarvam, Coinbase, AgentMail, Razorpay, Respan, écentic | Not relevant | Scraping, agent sandboxes, voice, video, payments, or Indian-language models. Nothing here needs them. |

## 9. Sources

RemFluent
- https://www.remfluent.com/
- https://chromewebstore.google.com/detail/remfluent-netflix-disney+/hkjcilfgjfipofmbomibmifbjalchboo
- https://fluentai.pro/guides/remfluent-alternative
- https://extpose.com/ext/hkjcilfgjfipofmbomibmifbjalchboo

Competitors and prior art
- https://github.com/asbplayer/asbplayer (netflix-page.ts, disney-plus-page.ts, youtube-page.ts, services/youtube.ts, pages/m3u8-util.ts)
- https://github.com/rsimmons/subadub
- https://github.com/jennimao/seeingdouble
- https://github.com/mikesteele/dual-captions
- https://github.com/reza-nzri/yt-dual-sub
- https://github.com/wonmin82/streaming-subtitle-downloaders
- https://en.wikipedia.org/wiki/Language_Reactor
- https://lexpresso.io/blog/language-reactor-vs-migaku-vs-trancy-vs-lexpresso/
- https://wordy.info/blog/lingopie-alternatives

Netflix breakage, June 2026
- https://forum.languagelearningwithnetflix.com/t/netflix-subtitles-broken-manifest-call-is-now-licensedmanifest-timedtext-urls-no-longer-exposed/41824
- https://forum.languagelearningwithnetflix.com/t/language-reactor-pro-not-working-and-completely-broken/44341
- https://deeplingo.ca/resources/articles/language-reactor-not-working-netflix
- https://greasyfork.org/en/scripts/26654-netflix-subtitle-downloader/discussions/160992

YouTube PoToken
- https://github.com/jdepoix/youtube-transcript-api/issues/592
- https://github.com/maximtop/topskip/pull/20
- https://dev.to/jamhimself/why-your-youtube-transcript-scraper-started-returning-empty-strings-and-how-to-fix-it-in-2026-20ed

Translation and AI in Chrome
- https://developer.chrome.com/docs/ai/translator-api
- https://developer.mozilla.org/en-US/docs/Web/API/Translator_and_Language_Detector_APIs
- https://developer.chrome.com/docs/extensions/ai
- https://github.com/eeeXun/gtt/issues/43 (gtx endpoint blocked)
- https://huggingface.co/blog/transformersjs-v3
- https://huggingface.co/spaces/webml-community/whisper-large-v3-turbo-webgpu

Dictionary data
- https://en.wiktionary.org/api/rest_v1/page/definition/manger
- https://freedictionaryapi.com/
- https://kaikki.org/dictionary/French/index.html
- https://www.npmjs.com/package/node-lefff

Framework
- https://wxt.dev/guide/resources/compare
- https://dev.to/extensionbooster/plasmo-vs-crxjs-vs-wxt-which-chrome-extension-framework-should-you-use-in-2026-37o4

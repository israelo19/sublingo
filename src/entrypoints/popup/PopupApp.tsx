import { browser } from '#imports';
import { useEffect, useState } from 'preact/hooks';
import type { AzureTtsResponse, AzureVoicesResponse } from '@/lib/messages';
import { DEFAULT_SETTINGS, LANGUAGES, loadSettings, settingsItem, watchSettings, type Settings } from '@/lib/settings';
import { mtSupported } from '@/lib/translate/chrome';
import { AZURE_REGIONS, defaultAzureVoice } from '@/lib/tts/azure';
import { loadVoices, rankVoices, speakBrowser } from '@/lib/tts/browser';
import { vocabItem } from '@/lib/vocab';

const SAMPLES: Record<string, string> = {
  fr: 'Bonjour ! Je suis la voix qui lira les sous-titres.',
  en: 'Hello! I am the voice that will read the captions.',
  es: '¡Hola! Soy la voz que leerá los subtítulos.',
  de: 'Hallo! Ich bin die Stimme, die die Untertitel liest.',
  it: 'Ciao! Sono la voce che leggerà i sottotitoli.',
  pt: 'Olá! Eu sou a voz que vai ler as legendas.',
};
const sampleFor = (lang: string) => SAMPLES[lang.split('-')[0]] ?? SAMPLES.en;
const languageName = (code: string) => LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();

type AzureVoiceOption = { shortName: string; displayName: string; locale: string; gender?: string };

export function PopupApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [vocabCount, setVocabCount] = useState(0);
  const mt = mtSupported();

  useEffect(() => {
    void loadSettings().then(setSettings);
    void vocabItem.getValue().then((v) => setVocabCount(v.length));
    const unwatchSettings = watchSettings(setSettings);
    const unwatchVocab = vocabItem.watch((v) => setVocabCount(v?.length ?? 0));
    return () => {
      unwatchSettings();
      unwatchVocab();
    };
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void settingsItem.setValue(next);
  };

  const openVocab = () => {
    void browser.tabs.create({ url: browser.runtime.getURL('/vocab.html') });
  };

  // ---- Dub mode helpers ----
  const [azureVoices, setAzureVoices] = useState<AzureVoiceOption[]>([]);
  const [azureStatus, setAzureStatus] = useState('');
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    void loadVoices().then((all) => setBrowserVoices(rankVoices(all, settings.primaryLang)));
  }, [settings.primaryLang]);

  const loadAzureVoices = async () => {
    setAzureStatus('Loading voices…');
    const res = (await browser.runtime.sendMessage({ type: 'azure-voices', lang: settings.primaryLang, key: settings.azureKey, region: settings.azureRegion })) as AzureVoicesResponse;
    if ('error' in res) {
      setAzureStatus(res.error);
      return;
    }
    setAzureVoices(res.voices);
    setAzureStatus(`${res.voices.length} ${languageName(settings.primaryLang)} voices available`);
  };

  const testAzure = async () => {
    setAzureStatus('Synthesizing…');
    const res = (await browser.runtime.sendMessage({ type: 'tts-azure', text: sampleFor(settings.primaryLang), lang: settings.primaryLang, voice: settings.azureVoice || undefined })) as AzureTtsResponse;
    if ('error' in res) {
      setAzureStatus(res.error);
      return;
    }
    await new Audio(`data:${res.mime};base64,${res.audio}`).play().catch((e: unknown) => setAzureStatus(String(e)));
    setAzureStatus(res.cached ? 'Played (cached)' : 'Played. Azure is working.');
  };

  const testBrowser = () => {
    const voice = browserVoices.find((v) => v.name === settings.browserVoice) ?? browserVoices[0];
    speakBrowser(sampleFor(settings.primaryLang), { lang: settings.primaryLang, voice });
  };

  const Toggle = ({ k, label, hint, disabled }: { k: keyof Settings; label: string; hint?: string; disabled?: boolean }) => (
    <label class={`row${disabled ? ' disabled' : ''}`}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        disabled={disabled}
        checked={Boolean(settings[k])}
        onChange={(e) => update({ [k]: (e.currentTarget as HTMLInputElement).checked } as Partial<Settings>)}
      />
    </label>
  );

  return (
    <main>
      <header>
        <h1>Sublingo</h1>
        <label class="switch">
          <input type="checkbox" checked={settings.enabled} onChange={(e) => update({ enabled: (e.currentTarget as HTMLInputElement).checked })} />
          <span>{settings.enabled ? 'On' : 'Off'}</span>
        </label>
      </header>

      <section>
        <label class="row">
          <span>
            I'm learning<small>Main line, dictionary language</small>
          </span>
          <select value={settings.primaryLang} onChange={(e) => update({ primaryLang: (e.currentTarget as HTMLSelectElement).value })}>
            {LANGUAGES.map((l) => (
              <option value={l.code}>{l.name}</option>
            ))}
          </select>
        </label>
        <label class="row">
          <span>
            I speak<small>Second line</small>
          </span>
          <select value={settings.secondaryLang} onChange={(e) => update({ secondaryLang: (e.currentTarget as HTMLSelectElement).value })}>
            {LANGUAGES.map((l) => (
              <option value={l.code}>{l.name}</option>
            ))}
          </select>
        </label>
      </section>

      <section>
        <Toggle k="showSecondary" label="Show translation line" hint="Hotkey: W" />
        <Toggle k="blurSecondary" label="Blur translation until hover" />
        <Toggle k="autoPause" label="Pause after every line" hint="Hotkey: Q" />
        <Toggle k="pauseOnWordClick" label="Pause when I click a word" />
        <Toggle k="hoverPause" label="Pause while hovering the captions" />
        <Toggle
          k="machineTranslation"
          label="Chrome on-device translation"
          hint={mt ? 'Word glosses and literal line translations, free and offline' : 'Not available in this browser'}
          disabled={!mt}
        />
        <Toggle k="hideNativeCaptions" label="Hide the site's own captions" />
      </section>

      <section>
        <label class="row">
          <span>
            Text size<small>{settings.fontSize}%</small>
          </span>
          <input type="range" min={60} max={180} step={10} value={settings.fontSize} onInput={(e) => update({ fontSize: Number((e.currentTarget as HTMLInputElement).value) })} />
        </label>
        <label class="row">
          <span>
            Caption height<small>{settings.captionOffset}% from the bottom</small>
          </span>
          <input type="range" min={4} max={45} step={1} value={settings.captionOffset} onInput={(e) => update({ captionOffset: Number((e.currentTarget as HTMLInputElement).value) })} />
        </label>
      </section>

      <section class="dub">
        <Toggle k="dubMode" label={`Listen in ${languageName(settings.primaryLang)}`} hint="Hotkey: V. Uses the video's own audio track when it has one, otherwise a voice reads the captions" />
        {settings.dubMode && (
          <>
            <label class="row">
              <span>
                Voice<small>Auto = Azure when a key is set, else the browser voice</small>
              </span>
              <select value={settings.dubProvider} onChange={(e) => update({ dubProvider: (e.currentTarget as HTMLSelectElement).value as Settings['dubProvider'] })}>
                <option value="auto">Auto</option>
                <option value="azure">Azure neural</option>
                <option value="browser">Browser voice</option>
              </select>
            </label>
            <label class="row">
              <span>
                Original audio while speaking<small>{Math.round(settings.dubDuck * 100)}% — keeps music and ambience</small>
              </span>
              <input type="range" min={0} max={100} step={5} value={Math.round(settings.dubDuck * 100)} onInput={(e) => update({ dubDuck: Number((e.currentTarget as HTMLInputElement).value) / 100 })} />
            </label>
            <Toggle k="dubSlowVideo" label="Slow the video slightly for long lines" />

            <details class="sub">
              <summary>Azure neural voice {settings.azureKey ? '· key set' : '· not set up'}</summary>
              <div class="sub-body">
                <label class="col">
                  Key
                  <input type="password" placeholder="Paste Key 1 from your Speech resource" value={settings.azureKey} onChange={(e) => update({ azureKey: (e.currentTarget as HTMLInputElement).value.trim() })} />
                </label>
                <label class="col">
                  Region
                  <select value={settings.azureRegion} onChange={(e) => update({ azureRegion: (e.currentTarget as HTMLSelectElement).value })}>
                    {AZURE_REGIONS.map((r) => (
                      <option value={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <label class="col">
                  Voice
                  <select value={settings.azureVoice} onChange={(e) => update({ azureVoice: (e.currentTarget as HTMLSelectElement).value })}>
                    <option value="">Default ({defaultAzureVoice(settings.primaryLang)})</option>
                    {azureVoices.map((v) => (
                      <option value={v.shortName}>
                        {v.displayName} · {v.locale}
                        {v.gender ? ` · ${v.gender}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <div class="btns">
                  <button onClick={() => void loadAzureVoices()} disabled={!settings.azureKey}>
                    Load voices
                  </button>
                  <button onClick={() => void testAzure()} disabled={!settings.azureKey}>
                    Test voice
                  </button>
                </div>
                {azureStatus && <small class="status">{azureStatus}</small>}
                <small>Free tier: 500k characters a month, 20 lines a minute. Key stays on this device.</small>
              </div>
            </details>

            <details class="sub">
              <summary>Browser voice (fallback)</summary>
              <div class="sub-body">
                <label class="col">
                  Voice
                  <select value={settings.browserVoice} onChange={(e) => update({ browserVoice: (e.currentTarget as HTMLSelectElement).value })}>
                    <option value="">Best available</option>
                    {browserVoices.map((v) => (
                      <option value={v.name}>
                        {v.name} · {v.lang}
                      </option>
                    ))}
                  </select>
                </label>
                <div class="btns">
                  <button onClick={testBrowser} disabled={!browserVoices.length}>
                    Test voice
                  </button>
                </div>
                {!browserVoices.length && <small>No {languageName(settings.primaryLang)} voice installed. On macOS: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices.</small>}
              </div>
            </details>
          </>
        )}
      </section>

      <section class="actions">
        <button class="primary" onClick={openVocab}>
          Saved words ({vocabCount})
        </button>
      </section>

      <footer>
        <div class="keys">
          <span>
            <kbd>A</kbd> previous line
          </span>
          <span>
            <kbd>S</kbd> replay
          </span>
          <span>
            <kbd>D</kbd> next line
          </span>
          <span>
            <kbd>Q</kbd> auto-pause
          </span>
          <span>
            <kbd>W</kbd> translation
          </span>
        </div>
      </footer>
    </main>
  );
}

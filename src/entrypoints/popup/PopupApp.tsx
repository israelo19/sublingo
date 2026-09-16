import { browser } from '#imports';
import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_SETTINGS, LANGUAGES, loadSettings, settingsItem, watchSettings, type Settings } from '@/lib/settings';
import { mtSupported } from '@/lib/translate/chrome';
import { vocabItem } from '@/lib/vocab';

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

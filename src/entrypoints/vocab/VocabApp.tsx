import { browser } from '#imports';
import { useEffect, useState } from 'preact/hooks';
import type { AnkiExportResponse, AnkiStatusResponse } from '@/lib/messages';
import { DEFAULT_SETTINGS, loadSettings, settingsItem, watchSettings, type Settings } from '@/lib/settings';
import { removeVocab, sourceUrl, toCsv, vocabItem, type VocabEntry } from '@/lib/vocab';

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

function highlight(sentence: string, word: string) {
  const idx = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (!word || idx < 0) return sentence;
  return (
    <>
      {sentence.slice(0, idx)}
      <mark>{sentence.slice(idx, idx + word.length)}</mark>
      {sentence.slice(idx + word.length)}
    </>
  );
}

export function VocabApp() {
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void vocabItem.getValue().then(setEntries);
    void loadSettings().then(setSettings);
    const unwatchVocab = vocabItem.watch((v) => setEntries(v ?? []));
    const unwatchSettings = watchSettings(setSettings);
    return () => {
      unwatchVocab();
      unwatchSettings();
    };
  }, []);

  const q = query.trim().toLowerCase();
  const shown = q
    ? entries.filter((e) => [e.word, e.lemma, e.definition, e.sentence, e.translation, e.literal, e.title].some((x) => x?.toLowerCase().includes(q)))
    : entries;
  const pending = entries.filter((e) => !e.ankiNoteId).length;

  const exportCsv = () => {
    const blob = new Blob([toCsv(entries)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sublingo-vocab-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const sendToAnki = async () => {
    setBusy(true);
    setStatus('Sending to Anki…');
    try {
      const res = (await browser.runtime.sendMessage({ type: 'anki-export' })) as AnkiExportResponse;
      if ('error' in res) setStatus(`Anki: ${res.error}`);
      else setStatus(`Anki: added ${res.added}${res.skipped ? `, skipped ${res.skipped} already in the deck` : ''}.`);
    } finally {
      setBusy(false);
    }
  };

  const testAnki = async () => {
    setStatus('Checking Anki…');
    const res = (await browser.runtime.sendMessage({ type: 'anki-status' })) as AnkiStatusResponse;
    setStatus('error' in res ? `Anki: ${res.error}` : `Anki is reachable (AnkiConnect v${res.version}).`);
  };

  const updateSettings = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void settingsItem.setValue(next);
  };

  return (
    <main>
      <header>
        <h1>Saved words</h1>
        <input type="search" placeholder="Search words, sentences, videos…" value={query} onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
      </header>

      <section class="toolbar">
        <button onClick={exportCsv} disabled={!entries.length}>
          Export CSV
        </button>
        <button class="primary" onClick={sendToAnki} disabled={busy || !pending}>
          Send {pending} new to Anki
        </button>
        <details>
          <summary>Anki settings</summary>
          <div class="anki-settings">
            <label>
              Deck
              <input value={settings.ankiDeck} onChange={(e) => updateSettings({ ankiDeck: (e.currentTarget as HTMLInputElement).value })} />
            </label>
            <label>
              Note type
              <input value={settings.ankiModel} onChange={(e) => updateSettings({ ankiModel: (e.currentTarget as HTMLInputElement).value })} />
            </label>
            <label>
              AnkiConnect URL
              <input value={settings.ankiUrl} onChange={(e) => updateSettings({ ankiUrl: (e.currentTarget as HTMLInputElement).value })} />
            </label>
            <button onClick={testAnki}>Test connection</button>
            <p class="hint">
              Needs Anki open with the <a href="https://ankiweb.net/shared/info/2055492159" target="_blank" rel="noreferrer">AnkiConnect</a> add-on. The note type is created for you.
            </p>
          </div>
        </details>
        <span class="status">{status}</span>
      </section>

      {shown.length === 0 && (
        <p class="empty">{entries.length === 0 ? 'No saved words yet. Click a word in the captions and press “Save word”.' : 'No matches.'}</p>
      )}

      <ul class="list">
        {shown.map((e) => {
          const url = sourceUrl(e);
          return (
            <li key={e.id}>
              <div class="row-head">
                <span class="word">{e.word}</span>
                {e.lemma && e.lemma !== e.word && <span class="lemma">→ {e.lemma}</span>}
                {e.ipa && <span class="ipa">{e.ipa}</span>}
                {e.ankiNoteId && <span class="tag">Anki ✓</span>}
                <button class="del" onClick={() => void removeVocab(e.id)} aria-label="Delete">
                  ×
                </button>
              </div>
              {e.definition && <div class="def">{e.definition}</div>}
              <div class="sentence">{highlight(e.sentence, e.word)}</div>
              {(e.literal || e.translation) && <div class="tr">{e.literal || e.translation}</div>}
              <div class="meta">
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer">
                    {e.title || 'Open video'} · {fmtTime(e.time)}
                  </a>
                ) : (
                  <span>{e.title}</span>
                )}
                <span>{new Date(e.savedAt).toLocaleDateString()}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

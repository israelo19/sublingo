import type { DictEntry } from '@/lib/dictionary/types';
import type { OverlayActions } from './App';
import type { PopupState } from './store';

function highlight(sentence: string, word: string) {
  if (!word) return sentence;
  const idx = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (idx < 0) return sentence;
  return (
    <>
      {sentence.slice(0, idx)}
      <mark>{sentence.slice(idx, idx + word.length)}</mark>
      {sentence.slice(idx + word.length)}
    </>
  );
}

function Entries({ entries, max = 2 }: { entries: DictEntry[]; max?: number }) {
  return (
    <>
      {entries.slice(0, max).map((e, i) => (
        <div class="sl-entry" key={i}>
          {e.partOfSpeech && <span class="sl-pos">{e.partOfSpeech}</span>}
          <ol>
            {e.senses.slice(0, 4).map((s, j) => (
              <li key={j}>{s.definition}</li>
            ))}
          </ol>
        </div>
      ))}
    </>
  );
}

export function WordPopup({ popup, actions }: { popup: PopupState; actions: OverlayActions }) {
  const r = popup.result;
  const ipa = r?.entries.find((e) => e.ipa)?.ipa ?? r?.lemmaEntries?.find((e) => e.ipa)?.ipa;
  const formNote = r?.lemma ? r.entries[0]?.senses[0]?.definition : undefined;
  const style = { '--x': `${popup.x}px`, '--y': `${popup.y}px` } as Record<string, string>;

  return (
    <div class="sl-popup" style={style} role="dialog" aria-label={`Dictionary: ${popup.word}`}>
      <div class="sl-popup-head">
        <span class="sl-popup-word">{r?.word ?? popup.word}</span>
        {r?.lemma && (
          <span class="sl-popup-lemma">
            →{' '}
            <button class="sl-link" onClick={() => actions.onLookupLemma(r.lemma!)}>
              {r.lemma}
            </button>
          </span>
        )}
        {ipa && <span class="sl-popup-ipa">{ipa}</span>}
        <button class="sl-close" onClick={actions.onClosePopup} aria-label="Close">
          ×
        </button>
      </div>

      <div class="sl-popup-body">
        {popup.loading && <div class="sl-muted">Looking up…</div>}
        {popup.error && <div class="sl-error">{popup.error}</div>}
        {r?.notFound && <div class="sl-muted">No dictionary entry found for “{popup.word}”.</div>}
        {r && !r.notFound && (
          <>
            {formNote && r.lemmaEntries && <div class="sl-form-note">{formNote}</div>}
            {r.lemmaEntries ? <Entries entries={r.lemmaEntries} /> : <Entries entries={r.entries} />}
          </>
        )}
      </div>

      {popup.sentence && <div class="sl-popup-sentence">{highlight(popup.sentence, popup.word)}</div>}

      <div class="sl-popup-foot">
        <button class="sl-btn" onClick={actions.onSave} disabled={popup.saved || !r || r.notFound}>
          {popup.saved ? 'Saved ✓' : 'Save word'}
        </button>
        {r?.sourceUrl && (
          <a class="sl-source" href={r.sourceUrl} target="_blank" rel="noreferrer">
            {r.source === 'wiktionary' ? 'Wiktionary' : 'Free Dictionary API'} · CC BY-SA
          </a>
        )}
      </div>
    </div>
  );
}

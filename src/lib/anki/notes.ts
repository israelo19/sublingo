import { sourceUrl, type VocabEntry } from '@/lib/vocab-model';

export const ANKI_FIELDS = ['Word', 'Lemma', 'IPA', 'Definition', 'Sentence', 'Translation', 'Source'] as const;

export const ANKI_CSS = `
.card { font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 20px; text-align: center; color: #eee; background: #16161a; padding: 16px; }
.word { font-size: 34px; font-weight: 700; }
.lemma { color: #aaa; font-size: 16px; }
.ipa { color: #9ad; margin: 6px 0; }
.sentence { margin-top: 14px; font-size: 22px; }
.sentence b { color: #ffd86b; }
.def { margin-top: 12px; }
.tr { color: #bbb; margin-top: 8px; font-size: 17px; }
.src { margin-top: 14px; font-size: 13px; } .src a { color: #888; }
`;

export const ANKI_FRONT = `<div class="word">{{Word}}</div><div class="sentence">{{Sentence}}</div>`;
export const ANKI_BACK = `{{FrontSide}}<hr id=answer>{{#Lemma}}<div class="lemma">→ {{Lemma}}</div>{{/Lemma}}<div class="ipa">{{IPA}}</div><div class="def">{{Definition}}</div><div class="tr">{{Translation}}</div><div class="src">{{Source}}</div>`;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Bold the looked-up word inside its sentence (case-insensitive, first match). */
export function markWord(sentence: string, word: string): string {
  const safe = escapeHtml(sentence);
  if (!word) return safe;
  const idx = safe.toLowerCase().indexOf(escapeHtml(word).toLowerCase());
  if (idx < 0) return safe;
  const w = escapeHtml(word);
  return `${safe.slice(0, idx)}<b>${safe.slice(idx, idx + w.length)}</b>${safe.slice(idx + w.length)}`;
}

export interface AnkiNote {
  deckName: string;
  modelName: string;
  fields: Record<(typeof ANKI_FIELDS)[number], string>;
  tags: string[];
  options: { allowDuplicate: boolean; duplicateScope: string };
}

export function buildNote(e: VocabEntry, deckName: string, modelName: string): AnkiNote {
  const url = sourceUrl(e);
  const source = url ? `<a href="${url}">${escapeHtml(e.title || e.site)}</a>` : escapeHtml(e.title || e.site);
  return {
    deckName,
    modelName,
    fields: {
      Word: escapeHtml(e.word),
      Lemma: e.lemma && e.lemma !== e.word ? escapeHtml(e.lemma) : '',
      IPA: escapeHtml(e.ipa ?? ''),
      Definition: escapeHtml(e.definition ?? ''),
      Sentence: markWord(e.sentence, e.word),
      Translation: escapeHtml(e.literal || e.translation || ''),
      Source: source,
    },
    tags: ['sublingo', `lang::${e.lang}`, `site::${e.site}`],
    options: { allowDuplicate: false, duplicateScope: 'deck' },
  };
}

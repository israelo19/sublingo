/** Pure vocabulary types and helpers (no browser APIs), safe to import from tests and the Anki note builder. */
export interface VocabEntry {
  id: string;
  word: string;
  lemma?: string;
  ipa?: string;
  lang: string;
  sentence: string;
  /** The platform's translation line shown under the sentence, if any. */
  translation?: string;
  /** Chrome on-device literal translation of the sentence, if available. */
  literal?: string;
  definition?: string;
  site: string;
  videoId: string;
  title: string;
  /** seconds into the video */
  time: number;
  savedAt: number;
  /** Set once the entry has been added to Anki through AnkiConnect. */
  ankiNoteId?: number;
}

export function sourceUrl(e: Pick<VocabEntry, 'site' | 'videoId' | 'time'>): string {
  if (e.site === 'youtube' && e.videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(e.videoId)}&t=${Math.max(0, Math.floor(e.time))}s`;
  return '';
}

const csvCell = (v: unknown): string => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CSV_COLUMNS = ['word', 'lemma', 'ipa', 'lang', 'definition', 'sentence', 'translation', 'literal', 'title', 'url', 'time', 'savedAt'] as const;

export function toCsv(entries: VocabEntry[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = entries.map((e) =>
    CSV_COLUMNS.map((c) => {
      if (c === 'url') return csvCell(sourceUrl(e));
      if (c === 'savedAt') return csvCell(new Date(e.savedAt).toISOString());
      if (c === 'time') return csvCell(Math.floor(e.time));
      return csvCell(e[c]);
    }).join(','),
  );
  return [header, ...rows].join('\r\n') + '\r\n';
}

import type { Cue } from './types';

const TIMESTAMP = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{3})/;

const toSeconds = (m: RegExpMatchArray): number =>
  (m[1] ? parseInt(m[1], 10) * 3600 : 0) +
  parseInt(m[2], 10) * 60 +
  parseInt(m[3], 10) +
  parseInt(m[4], 10) / 1000;

/** Minimal WebVTT / SRT parser. Strips inline tags. */
export function parseVtt(text: string): Cue[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const cues: Cue[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.includes('-->')) {
      const [a, b] = line.split('-->');
      const ma = a.trim().match(TIMESTAMP);
      const mb = b.trim().match(TIMESTAMP);
      i++;
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        buf.push(lines[i]);
        i++;
      }
      if (ma && mb) {
        const cueText = buf
          .join(' ')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();
        if (cueText) cues.push({ start: toSeconds(ma), end: toSeconds(mb), text: cueText });
      }
    } else {
      i++;
    }
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

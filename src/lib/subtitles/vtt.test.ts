import { describe, expect, it } from 'vitest';
import { parseVtt } from './vtt';

const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.500
<c.yellow>Bonjour</c> à tous

00:01:00.000 --> 00:01:02.000 line:90%
Deuxième ligne
sur deux lignes
`;

describe('parseVtt', () => {
  it('parses timestamps and strips tags', () => {
    const cues = parseVtt(vtt);
    expect(cues).toEqual([
      { start: 1, end: 3.5, text: 'Bonjour à tous' },
      { start: 60, end: 62, text: 'Deuxième ligne sur deux lignes' },
    ]);
  });
});

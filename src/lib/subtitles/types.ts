export interface Cue {
  /** seconds */
  start: number;
  /** seconds */
  end: number;
  text: string;
}

export type TrackKind = 'manual' | 'asr' | 'translated';

export interface SubtitleTrack {
  id: string;
  /** BCP-47-ish code as reported by the platform, e.g. "fr", "fr-FR", "en-US" */
  lang: string;
  label: string;
  kind: TrackKind;
  url: string;
  /** For translated tracks: the language the machine translation was made from. */
  sourceLang?: string;
}

export interface TrackData {
  videoId: string;
  title: string;
  tracks: SubtitleTrack[];
  error?: string;
}

/** "fr-FR" -> "fr", "zh-Hans" -> "zh" */
export const baseLang = (lang: string): string => lang.toLowerCase().split(/[-_]/)[0];

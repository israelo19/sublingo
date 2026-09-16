import { computed, signal } from '@preact/signals';
import type { DictResult } from '@/lib/dictionary/types';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';
import { activeIndex, overlapping } from '@/lib/subtitles/active';
import type { Cue } from '@/lib/subtitles/types';

export type Status = 'idle' | 'loading' | 'ready' | 'error';

export interface PopupState {
  word: string;
  sentence: string;
  x: number;
  y: number;
  loading: boolean;
  result?: DictResult;
  error?: string;
  saved?: boolean;
  /** Chrome on-device translation of the word alone. */
  gloss?: string;
  /** Chrome on-device literal translation of the whole sentence. */
  literal?: string;
}

export const state = {
  settings: signal<Settings>(DEFAULT_SETTINGS),
  status: signal<Status>('idle'),
  statusMessage: signal(''),
  primaryCues: signal<Cue[]>([]),
  secondaryCues: signal<Cue[]>([]),
  primaryLabel: signal(''),
  secondaryLabel: signal(''),
  displayIndex: signal(-1),
  time: signal(0),
  paused: signal(true),
  popup: signal<PopupState | null>(null),
  /** On-device translation of the current line, used when the platform has no secondary track. */
  mtLine: signal(''),
  /** Short human-readable note about on-device translation (downloading, needs a click, off). */
  mtStatus: signal(''),
};

export const primaryCue = computed<Cue | undefined>(() => {
  const i = state.displayIndex.value;
  const cues = state.primaryCues.value;
  return i >= 0 && i < cues.length ? cues[i] : undefined;
});

/** Secondary-language text aligned to the primary cue's time window, else on-device translation. */
export const secondaryText = computed<string>(() => {
  const secondary = state.secondaryCues.value;
  if (!secondary.length) return state.mtLine.value;
  const p = primaryCue.value;
  if (p) {
    return overlapping(secondary, p.start, p.end)
      .filter((c) => {
        const overlap = Math.min(c.end, p.end) - Math.max(c.start, p.start);
        return overlap >= Math.min(0.3, 0.25 * (c.end - c.start));
      })
      .map((c) => c.text)
      .join(' ');
  }
  const i = activeIndex(secondary, state.time.value, 0.35);
  return i >= 0 ? secondary[i].text : '';
});

export const openPopup = (p: PopupState): void => {
  state.popup.value = p;
};

export const closePopup = (): void => {
  state.popup.value = null;
};

export const patchPopup = (patch: Partial<PopupState>): void => {
  if (state.popup.value) state.popup.value = { ...state.popup.value, ...patch };
};

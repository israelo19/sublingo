import { storage } from '#imports';

export interface Settings {
  enabled: boolean;
  /** Language you are learning; shown as the main line and used for dictionary lookups. */
  primaryLang: string;
  /** Language you already speak; shown as the smaller second line. */
  secondaryLang: string;
  showSecondary: boolean;
  blurSecondary: boolean;
  autoPause: boolean;
  pauseOnWordClick: boolean;
  /** Pause while the pointer is over the caption box, resume when it leaves. */
  hoverPause: boolean;
  hideNativeCaptions: boolean;
  /** Percent, 100 = default size. */
  fontSize: number;
  /** Distance of the caption box from the bottom of the player, in percent. */
  captionOffset: number;
  /** Use Chrome's on-device Translator API for literal translations and word glosses. */
  machineTranslation: boolean;
  ankiUrl: string;
  ankiDeck: string;
  ankiModel: string;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  primaryLang: 'fr',
  secondaryLang: 'en',
  showSecondary: true,
  blurSecondary: false,
  autoPause: false,
  pauseOnWordClick: true,
  hoverPause: false,
  hideNativeCaptions: true,
  fontSize: 100,
  captionOffset: 11,
  machineTranslation: true,
  ankiUrl: 'http://127.0.0.1:8765',
  ankiDeck: 'Sublingo',
  ankiModel: 'Sublingo',
};

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

/** Stored settings from an older version may lack newer keys; always merge over the defaults. */
export const mergeSettings = (stored: Partial<Settings> | null | undefined): Settings => ({ ...DEFAULT_SETTINGS, ...(stored ?? {}) });

export const loadSettings = async (): Promise<Settings> => mergeSettings(await settingsItem.getValue());

export const watchSettings = (cb: (s: Settings) => void): (() => void) => settingsItem.watch((v) => cb(mergeSettings(v)));

export const LANGUAGES: Array<{ code: string; name: string }> = [
  { code: 'fr', name: 'French' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'hi', name: 'Hindi' },
];

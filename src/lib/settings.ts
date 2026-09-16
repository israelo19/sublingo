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
  hideNativeCaptions: boolean;
  /** Percent, 100 = default size. */
  fontSize: number;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  primaryLang: 'fr',
  secondaryLang: 'en',
  showSecondary: true,
  blurSecondary: false,
  autoPause: false,
  pauseOnWordClick: true,
  hideNativeCaptions: true,
  fontSize: 100,
};

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

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

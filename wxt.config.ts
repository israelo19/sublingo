import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  publicDir: 'src/public',
  manifest: {
    name: 'Sublingo',
    description:
      'Learn languages by watching. Dual subtitles, click-any-word dictionary, and pause-with-caption on YouTube (Hulu, Netflix, and Disney+ coming).',
    permissions: ['storage', 'unlimitedStorage'],
    host_permissions: [
      'https://freedictionaryapi.com/*',
      'https://en.wiktionary.org/*',
      // AnkiConnect (local Anki add-on)
      'http://127.0.0.1:8765/*',
      'http://localhost:8765/*',
    ],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
  },
  vite: () => ({
    plugins: [preact()],
  }),
});

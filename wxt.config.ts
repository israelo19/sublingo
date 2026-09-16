import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Sublingo',
    description:
      'Learn languages by watching. Dual subtitles, click-any-word dictionary, and pause-with-caption on YouTube (Hulu, Netflix, and Disney+ coming).',
    permissions: ['storage', 'unlimitedStorage'],
    host_permissions: ['https://freedictionaryapi.com/*', 'https://en.wiktionary.org/*'],
  },
  vite: () => ({
    plugins: [preact()],
  }),
});

import { describe, expect, it } from 'vitest';
import { RateLimiter, buildSsml, defaultAzureVoice, effectiveAzureVoice, voiceLocale, voicesForLanguage } from './azure';

describe('buildSsml', () => {
  it('escapes text and sets the voice locale', () => {
    const ssml = buildSsml('Oui & "non" <vite>', 'fr-FR-DeniseNeural');
    expect(ssml).toContain('xml:lang="fr-FR"');
    expect(ssml).toContain('<voice name="fr-FR-DeniseNeural">Oui &amp; &quot;non&quot; &lt;vite&gt;</voice>');
  });
  it('adds prosody when a rate is requested', () => {
    expect(buildSsml('Bonjour', 'fr-FR-HenriNeural', 12)).toContain('<prosody rate="+12%">Bonjour</prosody>');
  });
});

describe('voices', () => {
  it('picks defaults by base language', () => {
    expect(defaultAzureVoice('fr-FR')).toBe('fr-FR-DeniseNeural');
    expect(defaultAzureVoice('xx')).toBe('en-US-AvaMultilingualNeural');
    expect(voiceLocale('pt-BR-FranciscaNeural')).toBe('pt-BR');
  });
  it('ignores a configured voice that speaks another language', () => {
    expect(effectiveAzureVoice('fr-FR-DeniseNeural', 'fr')).toBe('fr-FR-DeniseNeural');
    expect(effectiveAzureVoice('fr-FR-DeniseNeural', 'es')).toBe('es-ES-ElviraNeural');
    expect(effectiveAzureVoice('en-US-AvaMultilingualNeural', 'fr')).toBe('en-US-AvaMultilingualNeural');
    expect(effectiveAzureVoice('', 'de')).toBe('de-DE-KatjaNeural');
  });
  it('filters and ranks voices for a language', () => {
    const list = voicesForLanguage(
      [
        { ShortName: 'fr-FR-HenriNeural', DisplayName: 'Henri', Locale: 'fr-FR' },
        { ShortName: 'en-US-JennyNeural', DisplayName: 'Jenny', Locale: 'en-US' },
        { ShortName: 'fr-FR-Vivienne:DragonHDLatestNeural', DisplayName: 'Vivienne HD', Locale: 'fr-FR' },
        { ShortName: 'fr-CA-SylvieNeural', DisplayName: 'Sylvie', Locale: 'fr-CA' },
      ],
      'fr',
    );
    expect(list.map((v) => v.DisplayName)).toEqual(['Vivienne HD', 'Sylvie', 'Henri']);
  });
});

describe('RateLimiter', () => {
  it('allows max requests per window and then asks to wait', () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.waitMs(0)).toBe(0);
    rl.record(0);
    rl.record(100);
    expect(rl.waitMs(200)).toBe(800);
    expect(rl.waitMs(1001)).toBe(0);
  });
});

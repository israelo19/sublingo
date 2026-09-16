/**
 * Azure AI Speech, text-to-speech REST API.
 * Docs: https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech
 * Free tier (F0): 500k characters/month, 20 requests per 60 seconds, not adjustable.
 */
export const AZURE_OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
export const AZURE_F0_REQUESTS_PER_MINUTE = 20;

export const AZURE_DEFAULT_VOICES: Record<string, string> = {
  fr: 'fr-FR-DeniseNeural',
  en: 'en-US-AvaMultilingualNeural',
  es: 'es-ES-ElviraNeural',
  de: 'de-DE-KatjaNeural',
  it: 'it-IT-ElsaNeural',
  pt: 'pt-BR-FranciscaNeural',
  ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural',
  zh: 'zh-CN-XiaoxiaoNeural',
  ru: 'ru-RU-SvetlanaNeural',
  ar: 'ar-EG-SalmaNeural',
  nl: 'nl-NL-ColetteNeural',
  sv: 'sv-SE-SofieNeural',
  pl: 'pl-PL-ZofiaNeural',
  tr: 'tr-TR-EmelNeural',
  hi: 'hi-IN-SwaraNeural',
};

export const AZURE_REGIONS = [
  'eastus', 'eastus2', 'westus', 'westus2', 'westus3', 'centralus', 'northcentralus', 'southcentralus', 'westcentralus',
  'canadacentral', 'canadaeast', 'brazilsouth', 'northeurope', 'westeurope', 'uksouth', 'ukwest', 'francecentral',
  'germanywestcentral', 'swedencentral', 'switzerlandnorth', 'norwayeast', 'italynorth', 'eastasia', 'southeastasia',
  'japaneast', 'japanwest', 'koreacentral', 'australiaeast', 'centralindia', 'uaenorth', 'southafricanorth', 'qatarcentral',
];

export const defaultAzureVoice = (lang: string): string => AZURE_DEFAULT_VOICES[lang.toLowerCase().split(/[-_]/)[0]] ?? AZURE_DEFAULT_VOICES.en;

/** "fr-FR-DeniseNeural" -> "fr-FR" */
export const voiceLocale = (voice: string): string => voice.split('-').slice(0, 2).join('-');

export const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function buildSsml(text: string, voice: string, ratePercent = 0): string {
  const locale = voiceLocale(voice);
  const body = escapeXml(text.trim());
  const inner = ratePercent ? `<prosody rate="${ratePercent > 0 ? '+' : ''}${Math.round(ratePercent)}%">${body}</prosody>` : body;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${voice}">${inner}</voice></speak>`;
}

export const azureTtsEndpoint = (region: string): string => `https://${region.trim().toLowerCase()}.tts.speech.microsoft.com/cognitiveservices/v1`;
export const azureVoicesEndpoint = (region: string): string => `https://${region.trim().toLowerCase()}.tts.speech.microsoft.com/cognitiveservices/voices/list`;

export class AzureError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AzureError';
  }
}

const explain = (status: number): string => {
  switch (status) {
    case 401:
      return 'Azure rejected the key. Check the key and that the region matches your Speech resource.';
    case 403:
      return 'Azure refused the request (403). The free monthly quota may be used up.';
    case 429:
      return 'Azure rate limit reached (free tier allows 20 requests per minute).';
    case 400:
      return 'Azure rejected the request (400). The voice name may be wrong for this region.';
    default:
      return `Azure returned HTTP ${status}.`;
  }
};

export interface AzureSynthesisOptions {
  key: string;
  region: string;
  voice: string;
  text: string;
  ratePercent?: number;
}

export async function azureSynthesize(o: AzureSynthesisOptions, fetchFn: typeof fetch = fetch): Promise<ArrayBuffer> {
  const res = await fetchFn(azureTtsEndpoint(o.region), {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': o.key.trim(),
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': AZURE_OUTPUT_FORMAT,
      'User-Agent': 'Sublingo',
    },
    body: buildSsml(o.text, o.voice, o.ratePercent),
  });
  if (!res.ok) throw new AzureError(explain(res.status), res.status);
  return res.arrayBuffer();
}

export interface AzureVoice {
  ShortName: string;
  DisplayName: string;
  LocalName?: string;
  Locale: string;
  Gender?: string;
  VoiceType?: string;
  Status?: string;
  WordsPerMinute?: string;
}

export async function azureListVoices(key: string, region: string, fetchFn: typeof fetch = fetch): Promise<AzureVoice[]> {
  const res = await fetchFn(azureVoicesEndpoint(region), { headers: { 'Ocp-Apim-Subscription-Key': key.trim() } });
  if (!res.ok) throw new AzureError(explain(res.status), res.status);
  return (await res.json()) as AzureVoice[];
}

/** Voices for a language, best-sounding first (HD, then multilingual, then neural). */
export function voicesForLanguage(voices: AzureVoice[], lang: string): AzureVoice[] {
  const base = lang.toLowerCase().split(/[-_]/)[0];
  const score = (v: AzureVoice) => (/HD/i.test(v.ShortName) ? 0 : /Multilingual/i.test(v.ShortName) ? 1 : 2);
  return voices
    .filter((v) => v.Locale.toLowerCase().startsWith(base) && (v.Status ?? 'GA') !== 'Deprecated')
    .sort((a, b) => score(a) - score(b) || a.Locale.localeCompare(b.Locale) || a.DisplayName.localeCompare(b.DisplayName));
}

/** A simple sliding-window limiter honouring Azure's F0 quota of 20 requests per 60 s. */
export class RateLimiter {
  private stamps: number[] = [];
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Milliseconds to wait before another request is allowed (0 = now). */
  waitMs(now = Date.now()): number {
    this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
    if (this.stamps.length < this.max) return 0;
    return this.stamps[0] + this.windowMs - now;
  }

  record(now = Date.now()): void {
    this.stamps.push(now);
  }
}

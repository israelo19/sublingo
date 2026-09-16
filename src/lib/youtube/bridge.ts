import type { TrackData } from '@/lib/subtitles/types';

export interface AudioTrackSummary {
  index: number;
  id: string;
  lang: string;
  name: string;
  kind: string;
  isDefault: boolean;
  current: boolean;
}

/**
 * Isolated-world side of the bridge to the MAIN-world YouTube script.
 * Payloads travel as JSON strings inside CustomEvent.detail so the same code
 * works in Chrome and Firefox without structured-clone surprises.
 */
export class YoutubeBridge {
  private seq = 0;

  getTracks(wantedLangs: string[], timeoutMs = 20000): Promise<TrackData> {
    return this.request<TrackData>('sublingo:get-tracks', 'sublingo:tracks', { wantedLangs }, timeoutMs);
  }

  async getAudioTracks(timeoutMs = 5000): Promise<AudioTrackSummary[]> {
    const res = await this.request<{ tracks: AudioTrackSummary[] }>('sublingo:audio-tracks', 'sublingo:audio-tracks-result', {}, timeoutMs);
    return res.tracks ?? [];
  }

  async setAudioTrack(id: string, timeoutMs = 5000): Promise<boolean> {
    const res = await this.request<{ ok: boolean }>('sublingo:set-audio-track', 'sublingo:set-audio-track-result', { id }, timeoutMs);
    return Boolean(res.ok);
  }

  async fetchText(url: string, timeoutMs = 20000): Promise<string> {
    const res = await this.request<{ ok: boolean; text?: string; error?: string }>(
      'sublingo:fetch',
      'sublingo:fetched',
      { url },
      timeoutMs,
    );
    if (!res.ok) throw new Error(res.error ?? 'fetch failed in page context');
    return res.text ?? '';
  }

  private request<T>(requestEvent: string, responseEvent: string, payload: object, timeoutMs: number): Promise<T> {
    const requestId = `${Date.now()}-${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        document.removeEventListener(responseEvent, handler);
        reject(new Error(`${requestEvent} timed out`));
      }, timeoutMs);
      const handler = (e: Event) => {
        let detail: (T & { requestId?: string }) | undefined;
        try {
          detail = JSON.parse((e as CustomEvent<string>).detail);
        } catch {
          return;
        }
        if (detail?.requestId !== requestId) return;
        window.clearTimeout(timer);
        document.removeEventListener(responseEvent, handler);
        resolve(detail);
      };
      document.addEventListener(responseEvent, handler);
      document.dispatchEvent(new CustomEvent(requestEvent, { detail: JSON.stringify({ requestId, ...payload }) }));
    });
  }
}

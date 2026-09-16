export interface PlayerAdapter {
  currentTime(): number;
  paused(): boolean;
  seek(seconds: number): void;
  play(): void;
  pause(): void;
  /** Fires roughly 10 times per second while mounted, and on play/pause/seek. */
  onTime(cb: (t: number, paused: boolean) => void): () => void;
  destroy(): void;
}

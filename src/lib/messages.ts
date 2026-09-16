import type { DictResult } from './dictionary/types';
import type { AnkiExportResult } from './anki/client';

export type LookupRequest = { type: 'lookup'; word: string; lang: string };
export type LookupResponse = DictResult | { error: string };

export type AnkiExportRequest = { type: 'anki-export'; ids?: string[] };
export type AnkiExportResponse = AnkiExportResult | { error: string };

export type AnkiStatusRequest = { type: 'anki-status' };
export type AnkiStatusResponse = { version: number } | { error: string };

export type Message = LookupRequest | AnkiExportRequest | AnkiStatusRequest;

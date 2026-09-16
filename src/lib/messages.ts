import type { DictResult } from './dictionary/types';

export type LookupRequest = { type: 'lookup'; word: string; lang: string };
export type LookupResponse = DictResult | { error: string };

export type Message = LookupRequest;

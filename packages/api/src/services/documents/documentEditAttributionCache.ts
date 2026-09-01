import { Buffer } from "node:buffer";
import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";
import type {
  ComputedDocumentEditAttribution,
  PreparedDocumentEditAttribution,
} from "../../workflows/documents/documentEditAttribution";

interface CacheEntry {
  readonly body: SerializedDocumentEditAttribution;
  readonly weight: number;
}

interface DataCacheEntry {
  readonly attribution: ComputedDocumentEditAttribution;
  readonly weight: number;
}

export interface SerializedDocumentEditAttribution {
  readonly attributionRevision: number;
  readonly json: string;
}

const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_DATA_CACHE_WEIGHT = 16 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 256;
const MAX_DATA_CACHE_ENTRIES = 128;
const CACHE_ENTRY_OVERHEAD = 256;

interface AttributionCacheState {
  cacheBytes: number;
  readonly cache: Map<string, CacheEntry>;
  readonly dataCache: Map<string, DataCacheEntry>;
  dataCacheWeight: number;
}

const cacheByOwner = new WeakMap<object, AttributionCacheState>();

function cacheState(owner: object): AttributionCacheState {
  const existing = cacheByOwner.get(owner);
  if (existing) {
    return existing;
  }
  const created: AttributionCacheState = {
    cache: new Map(),
    cacheBytes: 0,
    dataCache: new Map(),
    dataCacheWeight: 0,
  };
  cacheByOwner.set(owner, created);
  return created;
}

function cacheEntryWeight(key: string, payloadWeight: number): number {
  return CACHE_ENTRY_OVERHEAD + 2 * key.length + payloadWeight;
}

export function documentEditAttributionCacheKey(
  prepared: PreparedDocumentEditAttribution,
): string {
  return `v2:${prepared.documentId}:${prepared.attributionScope}:${prepared.attributionRevision}`;
}

export function getCachedDocumentEditAttribution(
  prepared: PreparedDocumentEditAttribution,
  owner: object,
): SerializedDocumentEditAttribution | undefined {
  const state = cacheState(owner);
  const key = documentEditAttributionCacheKey(prepared);
  const entry = state.cache.get(key);
  if (!entry) {
    return undefined;
  }

  state.cache.delete(key);
  state.cache.set(key, entry);
  return entry.body;
}

export function setCachedDocumentEditAttribution(
  response: DocumentEditAttributionResponse,
  prepared: PreparedDocumentEditAttribution,
  owner: object,
): SerializedDocumentEditAttribution {
  const body = {
    attributionRevision: response.attributionRevision,
    json: JSON.stringify(response),
  };
  const key = documentEditAttributionCacheKey({
    ...prepared,
    attributionRevision: response.attributionRevision,
  });
  const weight = cacheEntryWeight(key, Buffer.byteLength(body.json, "utf8"));
  if (weight > MAX_CACHE_BYTES) {
    return body;
  }

  const state = cacheState(owner);
  const previous = state.cache.get(key);
  if (previous) {
    state.cacheBytes -= previous.weight;
    state.cache.delete(key);
  }
  while (
    state.cacheBytes + weight > MAX_CACHE_BYTES ||
    state.cache.size >= MAX_CACHE_ENTRIES
  ) {
    const oldestKey = state.cache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    const oldest = state.cache.get(oldestKey);
    state.cache.delete(oldestKey);
    state.cacheBytes -= oldest?.weight ?? 0;
  }

  state.cache.set(key, { body, weight });
  state.cacheBytes += weight;
  return body;
}

function attributionDataWeight(
  attribution: ComputedDocumentEditAttribution,
): number {
  return attribution.segments.reduce(
    (weight, segment) =>
      weight +
      96 +
      2 *
        (segment.peerId.length +
          segment.updateId.length +
          segment.writerUserId.length +
          segment.writerKeyFingerprint.length),
    CACHE_ENTRY_OVERHEAD +
      2 * (attribution.documentId.length + attribution.attributionScope.length),
  );
}

export function getCachedDocumentEditAttributionData(
  prepared: PreparedDocumentEditAttribution,
  owner: object,
): ComputedDocumentEditAttribution | undefined {
  const state = cacheState(owner);
  const key = documentEditAttributionCacheKey(prepared);
  const entry = state.dataCache.get(key);
  if (!entry) {
    return undefined;
  }

  state.dataCache.delete(key);
  state.dataCache.set(key, entry);
  return entry.attribution;
}

export function setCachedDocumentEditAttributionData(
  attribution: ComputedDocumentEditAttribution,
  prepared: PreparedDocumentEditAttribution,
  owner: object,
): ComputedDocumentEditAttribution {
  const key = documentEditAttributionCacheKey({
    ...prepared,
    attributionRevision: attribution.attributionRevision,
  });
  const weight = cacheEntryWeight(key, attributionDataWeight(attribution));
  if (weight > MAX_DATA_CACHE_WEIGHT) {
    return attribution;
  }

  const state = cacheState(owner);
  const previous = state.dataCache.get(key);
  if (previous) {
    state.dataCacheWeight -= previous.weight;
    state.dataCache.delete(key);
  }
  while (
    state.dataCacheWeight + weight > MAX_DATA_CACHE_WEIGHT ||
    state.dataCache.size >= MAX_DATA_CACHE_ENTRIES
  ) {
    const oldestKey = state.dataCache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    const oldest = state.dataCache.get(oldestKey);
    state.dataCache.delete(oldestKey);
    state.dataCacheWeight -= oldest?.weight ?? 0;
  }

  state.dataCache.set(key, { attribution, weight });
  state.dataCacheWeight += weight;
  return attribution;
}

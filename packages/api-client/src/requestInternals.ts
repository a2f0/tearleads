import type { ListContainerParentLanesRequest } from "@tearleads/validators/request";
import type {
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
  PrincipalPolicyBundleResponse,
  SyncWatermark,
} from "@tearleads/validators/response";
import {
  isDocumentSyncStateStaleErrorResponse,
  isPaymentRequiredErrorResponse,
  isPrincipalPolicyStaleErrorResponse,
} from "@tearleads/validators/response";
import type { ListContainerDocumentsOptions, RequestBody } from "./types";

/**
 * True when a sync response advances the document's write material past what a
 * cached/primed writer projection holds, so the projection must be re-fetched
 * before the next write. Compares the content-key bundle and KEK target hashes
 * the projection authorizes against the ones the server just committed.
 */
function documentSyncInvalidatesWriterProjection(
  projection: DocumentWriterProjectionResponse,
  response: DocumentSyncResponse,
): boolean {
  return (
    projection.contentKeyBundle?.contentKeyEpoch !==
      response.contentKeyBundle?.contentKeyEpoch ||
    projection.contentKeyBundle?.linkSetManifestHash !==
      response.contentKeyBundle?.linkSetManifestHash ||
    projection.contentKeyBundle?.targetHash !==
      response.contentKeyBundle?.targetHash ||
    projection.documentKekTargets?.linkSetManifestHash !==
      response.documentKekTargets?.linkSetManifestHash ||
    projection.documentKekTargets?.documentKeyTargetHash !==
      response.documentKekTargets?.documentKeyTargetHash
  );
}

/**
 * Evict a cached/primed document writer projection iff the just-committed sync
 * response moved its write material. Re-checks the cache slot after awaiting so
 * a concurrent invalidation or refetch is not clobbered. `onEvicted` fires
 * whenever an invalidation is issued, so callers can invalidate parallel
 * bookkeeping (e.g. an in-flight result fetch that predates the sync).
 */
export async function evictWriterProjectionIfSyncChanged(
  cache: RequestCache<DocumentWriterProjectionResponse>,
  documentId: string,
  response: DocumentSyncResponse,
  onEvicted?: () => void,
): Promise<void> {
  const cached = cache.get(documentId);
  if (!cached) {
    // No cached projection to compare against, so whether the sync moved the
    // write material is undecidable here — but a concurrent in-flight GET may
    // still predate it. Invalidate conservatively: deleting the (absent) slot
    // bumps the cache's eviction generation so such a fetch's success is not
    // cached, and onEvicted drops a shared in-flight result entry. The cost
    // when nothing is in flight is a skipped cache warm, never wrong data.
    cache.delete(documentId);
    onEvicted?.();
    return;
  }
  const projection = await cached.catch(() => null);
  if (cache.get(documentId) !== cached || !projection) {
    return;
  }
  if (documentSyncInvalidatesWriterProjection(projection, response)) {
    cache.delete(documentId);
    onEvicted?.();
  }
}

export interface ErrorResponseDescription {
  readonly code: string | null;
  readonly detail: string;
  readonly error: string | null;
  readonly stalePrincipalPolicies?: PrincipalPolicyBundleResponse[] | undefined;
  /** Set on a 402 body — the organization whose billing blocked the sync write. */
  readonly paymentRequiredOrganizationId?: string | undefined;
}

export function bindPrototypeMethods(
  instance: object,
  prototype: object,
): void {
  for (const propertyName of Object.getOwnPropertyNames(prototype)) {
    if (propertyName === "constructor") {
      continue;
    }

    const property = Reflect.get(prototype, propertyName);
    if (typeof property === "function") {
      Reflect.set(instance, propertyName, property.bind(instance));
    }
  }
}

export function normalizeApiBaseUrl(
  baseUrl: string | null | undefined,
): string {
  const trimmed = (baseUrl ?? "").trim();
  if (trimmed === "" || trimmed === "/") {
    return "";
  }

  return trimmed.replace(/\/+$/u, "");
}

export function hasHeader(
  headers: Record<string, string> | undefined,
  name: string,
): boolean {
  const normalizedName = name.toLowerCase();
  return Object.keys(headers ?? {}).some(
    (headerName) => headerName.toLowerCase() === normalizedName,
  );
}

export function requestFailureKey(input: {
  method: string;
  path: string;
}): string {
  return `${input.method}\u0000${input.path}`;
}

function syncWatermarkRequestKey(
  watermark: SyncWatermark | null | undefined,
): string {
  return watermark ? `${watermark.updatedAt}\u0000${watermark.id}` : "";
}

export function listContainerParentLanesRequestKey(
  input: ListContainerParentLanesRequest,
): string {
  return JSON.stringify(
    input.lanes.map((lane) => ({
      laneId: lane.laneId,
      limit: lane.limit ?? null,
      parentId: lane.parentId,
      watermark: syncWatermarkRequestKey(lane.watermark),
    })),
  );
}

export function listContainerDocumentsRequestKey(
  containerId: string,
  options: ListContainerDocumentsOptions = {},
): string {
  const { watermark, ...rest } = options;
  return JSON.stringify({
    containerId,
    ...rest,
    watermark: syncWatermarkRequestKey(watermark),
  });
}

/**
 * Minimal cache surface shared by `Map` and `ApiCache.BoundedCache`, so the
 * request helpers work with either backing store.
 */
interface RequestCache<T> {
  get(key: string): Promise<T | null> | undefined;
  has(key: string): boolean;
  set(key: string, value: Promise<T | null>): unknown;
  delete(key: string): unknown;
}

export function cachedRequest<T>(
  cache: RequestCache<T>,
  cacheKey: string,
  request: () => Promise<T | null>,
): Promise<T | null> {
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let pending: Promise<T | null>;
  pending = request()
    .then((response) => {
      if (!response && cache.get(cacheKey) === pending) {
        cache.delete(cacheKey);
      }
      return response;
    })
    .catch((error: unknown) => {
      if (cache.get(cacheKey) === pending) {
        cache.delete(cacheKey);
      }
      throw error;
    });
  cache.set(cacheKey, pending);
  return pending;
}

export function dedupedRequest<T>(
  cache: RequestCache<T>,
  cacheKey: string,
  request: () => Promise<T | null>,
): Promise<T | null> {
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let pending: Promise<T | null>;
  pending = request().finally(() => {
    if (cache.get(cacheKey) === pending) {
      cache.delete(cacheKey);
    }
  });
  cache.set(cacheKey, pending);
  return pending;
}

export function isReplayableRequestBody(
  body: RequestBody | undefined,
): boolean {
  return !(
    typeof ReadableStream === "function" && body instanceof ReadableStream
  );
}

export async function describeErrorResponse(
  response: Response,
): Promise<ErrorResponseDescription> {
  let responseText = "";

  try {
    responseText = (await response.text()).trim();
  } catch {
    return { code: null, detail: "", error: null };
  }

  if (responseText.length === 0) {
    return { code: null, detail: "", error: null };
  }

  try {
    const parsed = JSON.parse(responseText);
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof parsed.error === "string" &&
      parsed.error.trim().length > 0
    ) {
      const error = parsed.error.trim();
      const code =
        "code" in parsed &&
        typeof parsed.code === "string" &&
        parsed.code.length > 0
          ? parsed.code
          : null;
      return {
        code,
        detail: `: ${error}`,
        error,
        // Container mutations and document sync with inline container rekeys
        // can carry signed policy bundles that make the failed write
        // repairable; preserve them on the typed failure object.
        ...(isPrincipalPolicyStaleErrorResponse(parsed)
          ? { stalePrincipalPolicies: parsed.principalPolicies }
          : isDocumentSyncStateStaleErrorResponse(parsed) &&
              parsed.principalPolicies !== undefined
            ? { stalePrincipalPolicies: parsed.principalPolicies }
            : {}),
        // Sync-write 402s carry the target org so the client can surface a
        // billing prompt; preserve it for the payment-required handler.
        ...(isPaymentRequiredErrorResponse(parsed)
          ? { paymentRequiredOrganizationId: parsed.organizationId }
          : {}),
      };
    }
  } catch {
    // Use the raw response body when the error payload is not JSON.
  }

  return { code: null, detail: `: ${responseText}`, error: null };
}

export function isRefreshableSessionError(
  status: number,
  error: string | null,
): boolean {
  return (
    status === 401 &&
    (error === "Session expired" || error === "Invalid session data")
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  // `instanceof Error` fails for errors thrown across realms (web workers,
  // serialized payloads); fall back to a duck-typed string `message`.
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

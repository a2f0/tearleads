import type { SyncWatermark } from "@tearleads/validators/response";
import type {
  ListContainerDocumentsOptions,
  ListContainersOptions,
} from "./routes/containers";
import type { RequestBody } from "./types";

export interface ErrorResponseDescription {
  readonly detail: string;
  readonly error: string | null;
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

function syncWatermarkRequestKey(
  watermark: SyncWatermark | null | undefined,
): string {
  return watermark ? `${watermark.updatedAt}\u0000${watermark.id}` : "";
}

export function listContainersRequestKey(
  options: ListContainersOptions = {},
): string {
  const { watermark, ...rest } = options;
  return JSON.stringify({
    ...rest,
    parentId: rest.parentId === undefined ? "__undefined__" : rest.parentId,
    watermark: syncWatermarkRequestKey(watermark),
  });
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

export function cachedRequest<T>(
  cache: Map<string, Promise<T | null>>,
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
  cache: Map<string, Promise<T | null>>,
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
    return { detail: "", error: null };
  }

  if (responseText.length === 0) {
    return { detail: "", error: null };
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
      return { detail: `: ${error}`, error };
    }
  } catch {
    // Use the raw response body when the error payload is not JSON.
  }

  return { detail: `: ${responseText}`, error: null };
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

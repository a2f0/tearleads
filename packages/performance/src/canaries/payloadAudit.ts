import { createHmac, randomBytes } from "node:crypto";

const minTrackedStringLength = 64;

/** Raw proxied request shape handed to the payload audit sink by app canaries. */
export interface RawPayloadRequest {
  readonly authorization: string | null;
  readonly knownManifestsCount?: number;
  readonly method: string;
  readonly requestBody: string | null;
  readonly requestBodyBytes: number;
  readonly responseBody: string;
  readonly responseBodyBytes: number;
  readonly routeKey: string;
  readonly status: number;
  readonly url: string;
}

export interface PolicyHeadRef {
  readonly principal: string;
  readonly version: string;
  readonly stateHash: string;
}

/** One sanitized JSONL record written per proxied request; no raw bodies or tokens. */
export interface PayloadRequestRecord {
  readonly phase: string;
  readonly pane: string;
  readonly route: string;
  readonly status: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly knownManifestsCount: number;
  readonly requestFieldBytes: Readonly<Record<string, number>>;
  readonly responseFieldBytes: Readonly<Record<string, number>>;
  readonly policyHead?: PolicyHeadRef;
  readonly echoBytes: number;
  readonly redeliveredBytes: number;
  readonly reDownloadedUploadBytes: number;
  readonly issuerStack?: string;
}

function hmacShort(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex").slice(0, 12);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function measureTopLevelFields(
  obj: Record<string, unknown> | null,
): Record<string, number> {
  if (!obj) return {};
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(obj)) {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) {
      result[key] = Buffer.byteLength(serialized, "utf8");
    }
  }
  return result;
}

function collectLongStringHashes(
  value: unknown,
  key: Buffer,
  out: Map<string, number>,
): void {
  if (typeof value === "string") {
    if (value.length >= minTrackedStringLength) {
      const hash = hmacShort(key, value);
      out.set(hash, Buffer.byteLength(value, "utf8"));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectLongStringHashes(item, key, out);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) {
      collectLongStringHashes(child, key, out);
    }
  }
}

function firstString(
  sources: readonly (Record<string, unknown> | undefined)[],
  keys: readonly string[],
): string | undefined {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function extractPolicyHead(
  obj: Record<string, unknown> | null,
): PolicyHeadRef | undefined {
  if (!obj) return undefined;
  const candidate =
    asRecord(Reflect.get(obj, "policy")) ??
    asRecord(Reflect.get(obj, "head")) ??
    obj;
  const version = Reflect.get(candidate, "version");
  const stateHash = firstString([candidate], ["stateHash", "state_hash"]);
  if (
    (typeof version !== "number" && typeof version !== "string") ||
    !stateHash
  ) {
    return undefined;
  }
  const principalType =
    firstString([candidate], ["principalType", "principal_type"]) ??
    "principal";
  const principalId = firstString(
    [candidate, obj],
    ["principalId", "principal_id", "organizationId", "groupId"],
  );
  return {
    principal: principalId
      ? `${principalType}:${principalId.slice(0, 8)}`
      : principalType,
    version: String(version),
    stateHash: stateHash.slice(0, 12),
  };
}

function classifyResponseStrings(
  reqHashes: ReadonlyMap<string, number>,
  resHashes: ReadonlyMap<string, number>,
  priorReceived: Set<string>,
  priorUploaded: Set<string>,
) {
  let echoBytes = 0;
  let redeliveredBytes = 0;
  let reDownloadedUploadBytes = 0;
  for (const [hash, bytes] of resHashes) {
    if (reqHashes.has(hash)) echoBytes += bytes;
    else if (priorReceived.has(hash)) redeliveredBytes += bytes;
    else if (priorUploaded.has(hash)) reDownloadedUploadBytes += bytes;
  }
  for (const hash of reqHashes.keys()) priorUploaded.add(hash);
  for (const hash of resHashes.keys()) priorReceived.add(hash);
  return { echoBytes, redeliveredBytes, reDownloadedUploadBytes };
}

export interface PayloadAuditor {
  resetTest(): void;
  recordPhase(input: {
    readonly label: string;
    readonly startIndex: number;
    readonly requests: readonly RawPayloadRequest[];
    readonly takeStack?: (method: string, url: string) => string | undefined;
  }): void;
}

/**
 * Stateful per-capture payload auditor. Hashes auth headers and long strings
 * with a random per-run key so raw tokens and bodies never reach disk, and
 * tracks request indexes so overlapping phases (like `test total`) are never
 * double-counted as redeliveries.
 */
export function createPayloadAuditor(options: {
  readonly write: (line: string) => void;
}): PayloadAuditor {
  const hashKey = randomBytes(32);
  const processedIndices = new Set<number>();
  const receivedByPane = new Map<string, Set<string>>();
  const uploadedByPane = new Map<string, Set<string>>();

  const paneSet = (map: Map<string, Set<string>>, pane: string) => {
    const existing = map.get(pane);
    if (existing) return existing;
    const created = new Set<string>();
    map.set(pane, created);
    return created;
  };

  const buildRecord = (
    phase: string,
    req: RawPayloadRequest,
    takeStack?: (method: string, url: string) => string | undefined,
  ): PayloadRequestRecord => {
    const pane = req.authorization
      ? hmacShort(hashKey, req.authorization).slice(0, 8)
      : "anon";
    const reqObj = parseJsonObject(req.requestBody);
    const resObj = parseJsonObject(req.responseBody);
    const reqHashes = new Map<string, number>();
    const resHashes = new Map<string, number>();
    collectLongStringHashes(reqObj, hashKey, reqHashes);
    collectLongStringHashes(resObj, hashKey, resHashes);
    const bytes = classifyResponseStrings(
      reqHashes,
      resHashes,
      paneSet(receivedByPane, pane),
      paneSet(uploadedByPane, pane),
    );
    const policyHead = extractPolicyHead(resObj);
    const issuerStack = takeStack?.(req.method, req.url);
    return {
      phase,
      pane,
      route: req.routeKey,
      status: req.status,
      requestBytes: req.requestBodyBytes,
      responseBytes: req.responseBodyBytes,
      knownManifestsCount: req.knownManifestsCount ?? 0,
      requestFieldBytes: measureTopLevelFields(reqObj),
      responseFieldBytes: measureTopLevelFields(resObj),
      ...(policyHead ? { policyHead } : {}),
      ...bytes,
      ...(issuerStack ? { issuerStack } : {}),
    };
  };

  return {
    resetTest() {
      processedIndices.clear();
      receivedByPane.clear();
      uploadedByPane.clear();
    },
    recordPhase({ label, startIndex, requests, takeStack }) {
      for (const [offset, req] of requests.entries()) {
        const absoluteIndex = startIndex + offset;
        if (processedIndices.has(absoluteIndex)) continue;
        processedIndices.add(absoluteIndex);
        options.write(
          `${JSON.stringify(buildRecord(label, req, takeStack))}\n`,
        );
      }
    },
  };
}

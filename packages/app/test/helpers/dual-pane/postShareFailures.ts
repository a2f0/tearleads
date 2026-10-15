import {
  DOCUMENT_MUTATION_ERROR_CODES,
  DOCUMENT_SYNC_ERROR_CODES,
} from "@tearleads/validators/response";
import type { ProxiedApiRequest } from "../proxiedApiResponse";

function pathOf(request: ProxiedApiRequest): string {
  return new URL(request.url).pathname;
}

function readJsonProperty(body: string | null, key: string): unknown {
  try {
    const parsed: unknown = JSON.parse(body ?? "");
    return typeof parsed === "object" && parsed !== null
      ? Reflect.get(parsed, key)
      : undefined;
  } catch {
    return undefined;
  }
}

function isSuccess(request: ProxiedApiRequest): boolean {
  return request.status >= 200 && request.status < 300;
}

export function isRetryableDocumentSyncFailure(
  request: ProxiedApiRequest,
): boolean {
  const code = readJsonProperty(request.responseBody, "code");
  return (
    request.method === "POST" &&
    request.status === 409 &&
    /^\/documents\/[^/]+\/sync$/u.test(pathOf(request)) &&
    (code === DOCUMENT_SYNC_ERROR_CODES.stateStale ||
      code === DOCUMENT_SYNC_ERROR_CODES.updateIdConflict ||
      code === DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict)
  );
}

function hasLaterSuccessfulRetry(
  requests: readonly ProxiedApiRequest[],
  failedRequestIndex: number,
): boolean {
  const failedRequest = requests[failedRequestIndex];
  return requests
    .slice(failedRequestIndex + 1)
    .some(
      (request) =>
        request.method === failedRequest?.method &&
        request.url === failedRequest.url &&
        request.status >= 200 &&
        request.status < 400,
    );
}

/**
 * The document id a `POST /documents` 409 `document_manifest_already_exists`
 * was issued for, or null for any other request. A device recovering an
 * identity re-creates the self contact under its deterministic id, which the
 * identity's first device already created; `createRemoteDocument` treats that
 * conflict as an idempotent create and adopts the existing document
 * (`isDocumentManifestAlreadyExistsConflict`).
 */
export function stableDocumentCreateConflictId(
  request: ProxiedApiRequest,
): string | null {
  if (
    request.method !== "POST" ||
    request.status !== 409 ||
    pathOf(request) !== "/documents" ||
    readJsonProperty(request.responseBody, "code") !==
      DOCUMENT_MUTATION_ERROR_CODES.manifestAlreadyExists
  ) {
    return null;
  }
  const event = readJsonProperty(request.requestBody, "event");
  const documentId =
    typeof event === "object" && event !== null
      ? Reflect.get(event, "objectId")
      : undefined;
  return typeof documentId === "string" && documentId.length > 0
    ? documentId
    : null;
}

/**
 * The conflict is resolved only when the same session later succeeds at a
 * request for that document (its sync or writer projection, which adoption
 * performs) and the conflict did not repeat for that document.
 */
function isAdoptedDocumentCreateConflict(
  requests: readonly ProxiedApiRequest[],
  index: number,
): boolean {
  const conflict = requests[index];
  const documentId = conflict ? stableDocumentCreateConflictId(conflict) : null;
  if (!conflict || !documentId) return false;
  const repeats = requests.filter(
    (request) => stableDocumentCreateConflictId(request) === documentId,
  ).length;
  const adoptionPaths = new Set([
    `/documents/${documentId}/sync`,
    `/documents/${documentId}/writer-projection`,
  ]);
  return (
    repeats === 1 &&
    requests
      .slice(index + 1)
      .some(
        (request) =>
          request.authorization === conflict.authorization &&
          isSuccess(request) &&
          adoptionPaths.has(pathOf(request)),
      )
  );
}

/** Failures that may still resolve while the runtime settles. */
export function mayResolvePostShareFailure(
  request: ProxiedApiRequest,
): boolean {
  return (
    isRetryableDocumentSyncFailure(request) ||
    stableDocumentCreateConflictId(request) !== null
  );
}

export function listUnresolvedPostShareFailures(
  requests: readonly ProxiedApiRequest[],
): ProxiedApiRequest[] {
  const unresolved = requests.filter((request, index) => {
    if (request.status < 400) return false;
    if (
      isRetryableDocumentSyncFailure(request) &&
      hasLaterSuccessfulRetry(requests, index)
    ) {
      return false;
    }
    return !isAdoptedDocumentCreateConflict(requests, index);
  });
  // An adopted create conflict counts as resolved only when nothing else
  // failed; any other unresolved failure keeps every conflict in the report.
  if (unresolved.length === 0) return unresolved;
  return requests.filter(
    (request, index) =>
      unresolved.includes(request) ||
      (stableDocumentCreateConflictId(request) !== null &&
        isAdoptedDocumentCreateConflict(requests, index)),
  );
}

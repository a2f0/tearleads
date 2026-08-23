import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";
import { serializeCanonical } from "./readers";
import type { DocumentSyncPlan, DocumentSyncSubmitFailure } from "./types";

type DocumentSyncPageSubmission =
  | {
      readonly ok: true;
      readonly response: DocumentSyncResponse;
    }
  | DocumentSyncSubmitFailure
  | null;

type DocumentSyncSubmission =
  | {
      readonly ok: true;
      readonly pullComplete: boolean;
      readonly response: DocumentSyncResponse;
    }
  | DocumentSyncSubmitFailure
  | null;

function continuationRequest(input: {
  readonly cursor: string;
  readonly plan: DocumentSyncPlan;
  readonly previousResponse: DocumentSyncResponse;
}): DocumentSyncRequest {
  const minLsn = input.previousResponse.commitLsn ?? input.plan.request.minLsn;
  return {
    contentKeyEpoch: input.plan.request.contentKeyEpoch,
    expectedLinkSetManifestHash: input.plan.request.expectedLinkSetManifestHash,
    expectedTargetHash: input.plan.request.expectedTargetHash,
    localVersionVector: input.plan.request.localVersionVector,
    ...(minLsn === undefined ? {} : { minLsn }),
    outgoingUpdates: [],
    pullCursor: input.cursor,
    supportsPullPagination: true,
    supportsUntrackedCommitLsn: true,
  };
}

function assertContinuationIdentity(
  first: DocumentSyncResponse,
  continuation: DocumentSyncResponse,
): void {
  if (continuation.documentId !== first.documentId) {
    throw new Error("Document sync continuation document mismatch");
  }
  if (
    serializeCanonical(
      continuation.contentKeyBundle,
      "continuation content-key bundle",
    ) !== serializeCanonical(first.contentKeyBundle, "first content-key bundle")
  ) {
    throw new Error("Document sync continuation content-key bundle mismatch");
  }
  if (
    serializeCanonical(
      continuation.documentKekTargets,
      "continuation KEK targets",
    ) !== serializeCanonical(first.documentKekTargets, "first KEK targets")
  ) {
    throw new Error("Document sync continuation KEK target mismatch");
  }
  if (continuation.acceptedOutgoingUpdateIds.length !== 0) {
    throw new Error("Document sync continuation accepted outgoing updates");
  }
}

function mergeDocumentSyncPages(
  aggregate: DocumentSyncResponse,
  page: DocumentSyncResponse,
): DocumentSyncResponse {
  const bundleKeys = new Set(
    aggregate.contentKeyBundles.map((bundle) =>
      serializeCanonical(bundle, "content-key bundle"),
    ),
  );
  const newBundles = page.contentKeyBundles.filter((bundle) => {
    const key = serializeCanonical(bundle, "content-key bundle");
    if (bundleKeys.has(key)) return false;
    bundleKeys.add(key);
    return true;
  });
  return {
    ...aggregate,
    commitLsn: page.commitLsn,
    ...(page.commitLsnMode === undefined
      ? { commitLsnMode: undefined }
      : { commitLsnMode: page.commitLsnMode }),
    contentKeyBundles: [...aggregate.contentKeyBundles, ...newBundles],
    pullPage: page.pullPage,
    updates: [...aggregate.updates, ...page.updates],
  };
}

function assertUniquePageUpdates(
  updateIds: Set<string>,
  response: DocumentSyncResponse,
): void {
  for (const update of response.updates) {
    if (updateIds.has(update.id)) {
      throw new Error("Document sync continuation repeated an update");
    }
    updateIds.add(update.id);
  }
}

export async function submitDocumentSyncPages(input: {
  readonly plan: DocumentSyncPlan;
  readonly submit: (
    request: DocumentSyncRequest,
  ) => Promise<DocumentSyncPageSubmission>;
}): Promise<DocumentSyncSubmission> {
  const first = await input.submit(input.plan.request);
  if (!first || !first.ok) return first;

  let aggregate = first.response;
  let previousResponse = first.response;
  const seenCursors = new Set<string>();
  const updateIds = new Set<string>();
  assertUniquePageUpdates(updateIds, first.response);

  let cursor = first.response.pullPage?.nextCursor ?? null;
  while (cursor !== null) {
    if (seenCursors.has(cursor)) {
      throw new Error("Document sync continuation cursor repeated");
    }
    seenCursors.add(cursor);
    const continuation = await input.submit(
      continuationRequest({ cursor, plan: input.plan, previousResponse }),
    );
    if (!continuation || !continuation.ok) {
      continuation?.report();
      return { ok: true, pullComplete: false, response: aggregate };
    }

    assertContinuationIdentity(first.response, continuation.response);
    assertUniquePageUpdates(updateIds, continuation.response);
    aggregate = mergeDocumentSyncPages(aggregate, continuation.response);
    previousResponse = continuation.response;
    cursor = continuation.response.pullPage?.nextCursor ?? null;
  }

  return { ok: true, pullComplete: true, response: aggregate };
}

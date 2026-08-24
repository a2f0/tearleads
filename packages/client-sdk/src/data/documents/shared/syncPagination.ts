import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";
import {
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES,
  parseWalLsn,
} from "@symcrypt/validators/util";
import { serializeCanonical } from "./readers";
import type {
  DocumentSyncApi,
  DocumentSyncPlan,
  DocumentSyncSubmitFailure,
} from "./types";

export type DocumentSyncCommitLsnMode = "tracked" | "untracked";

export interface DocumentSyncPullContinuation {
  readonly commitLsnMode: DocumentSyncCommitLsnMode;
  readonly cursor: string;
}

// Until page-at-a-time persistence lands, retain at most one continuation in
// memory. The aggregate is also bounded to one server page's update count.
const MAX_DOCUMENT_SYNC_PULL_PAGES_PER_SUBMISSION = 2;

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
    documentSyncCommitLsnMode(continuation) !== documentSyncCommitLsnMode(first)
  ) {
    throw new Error("Document sync continuation commit LSN mode changed");
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

function documentSyncCommitLsnMode(
  response: DocumentSyncResponse,
): DocumentSyncCommitLsnMode {
  return response.commitLsnMode === "untracked" ? "untracked" : "tracked";
}

export function readPullContinuation(
  response: DocumentSyncResponse,
): DocumentSyncPullContinuation | null {
  const cursor = requirePullPage(response).nextCursor;
  return cursor === null
    ? null
    : { commitLsnMode: documentSyncCommitLsnMode(response), cursor };
}

function assertPageCheckpoint(input: {
  readonly minLsn: string | undefined;
  readonly response: DocumentSyncResponse;
}): void {
  if (input.response.commitLsnMode === "untracked") {
    if (input.response.commitLsn !== "0/0") {
      throw new Error("Document sync continuation untracked LSN is invalid");
    }
    return;
  }
  if (input.minLsn === undefined) return;
  if (
    input.response.commitLsn === null ||
    parseWalLsn(input.response.commitLsn) < parseWalLsn(input.minLsn)
  ) {
    throw new Error("Document sync continuation commit LSN regressed");
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

function hasDurablePageProgress(response: DocumentSyncResponse): boolean {
  return (
    response.acceptedOutgoingUpdateIds.length > 0 || response.updates.length > 0
  );
}

function requirePullPage(response: DocumentSyncResponse) {
  if (response.pullPage === undefined) {
    throw new Error("Document sync response is missing pull page metadata");
  }
  return response.pullPage;
}

function reachedPullDrainLimit(input: {
  readonly pageCount: number;
  readonly updateCount: number;
}): boolean {
  return (
    input.pageCount >= MAX_DOCUMENT_SYNC_PULL_PAGES_PER_SUBMISSION ||
    input.updateCount >= MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES
  );
}

function incompletePullResult(
  response: DocumentSyncResponse,
): Extract<DocumentSyncSubmission, { readonly ok: true }> {
  if (!hasDurablePageProgress(response)) {
    throw new Error("Document sync incomplete pull made no durable progress");
  }
  return { ok: true, pullComplete: false, response };
}

async function submitDocumentSyncPages(input: {
  readonly expectedCommitLsnMode?: DocumentSyncCommitLsnMode | undefined;
  readonly plan: DocumentSyncPlan;
  readonly submit: (
    request: DocumentSyncRequest,
  ) => Promise<DocumentSyncPageSubmission>;
}): Promise<DocumentSyncSubmission> {
  const first = await input.submit(input.plan.request);
  if (!first || !first.ok) return first;
  if (
    input.expectedCommitLsnMode !== undefined &&
    documentSyncCommitLsnMode(first.response) !== input.expectedCommitLsnMode
  ) {
    throw new Error("Document sync continuation commit LSN mode changed");
  }
  assertPageCheckpoint({
    minLsn: input.plan.request.minLsn,
    response: first.response,
  });
  const firstPullPage = requirePullPage(first.response);

  let aggregate = first.response;
  let previousResponse = first.response;
  const seenCursors = new Set<string>();
  const updateIds = new Set<string>();
  assertUniquePageUpdates(updateIds, first.response);

  let cursor = firstPullPage.nextCursor;
  while (cursor !== null) {
    if (
      reachedPullDrainLimit({
        pageCount: seenCursors.size + 1,
        updateCount: updateIds.size,
      })
    ) {
      return incompletePullResult(aggregate);
    }
    if (seenCursors.has(cursor)) {
      throw new Error("Document sync continuation cursor repeated");
    }
    seenCursors.add(cursor);
    const request = continuationRequest({
      cursor,
      plan: input.plan,
      previousResponse,
    });
    const continuation = await input.submit(request);
    if (!continuation || !continuation.ok) {
      if (!hasDurablePageProgress(aggregate)) return continuation;
      continuation?.report();
      return incompletePullResult(aggregate);
    }

    assertContinuationIdentity(first.response, continuation.response);
    assertPageCheckpoint({
      minLsn: request.minLsn,
      response: continuation.response,
    });
    if (
      updateIds.size + continuation.response.updates.length >
      MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES
    ) {
      return incompletePullResult(aggregate);
    }
    assertUniquePageUpdates(updateIds, continuation.response);
    const continuationPullPage = requirePullPage(continuation.response);
    aggregate = mergeDocumentSyncPages(aggregate, continuation.response);
    previousResponse = continuation.response;
    cursor = continuationPullPage.nextCursor;
  }

  return { ok: true, pullComplete: true, response: aggregate };
}

export async function submitDocumentSync(input: {
  apiClient: DocumentSyncApi;
  expectedCommitLsnMode?: DocumentSyncCommitLsnMode | undefined;
  plan: DocumentSyncPlan;
}): Promise<DocumentSyncSubmission> {
  return submitDocumentSyncPages({
    expectedCommitLsnMode: input.expectedCommitLsnMode,
    plan: input.plan,
    submit: async (request) => {
      if (input.apiClient.syncDocumentResult) {
        const result = await input.apiClient.syncDocumentResult(
          input.plan.documentId,
          request,
          { reportErrors: false },
        );
        return result.ok ? { ok: true, response: result.data } : result;
      }

      const response = await input.apiClient.syncDocument(
        input.plan.documentId,
        request,
      );
      return response ? { ok: true, response } : null;
    },
  });
}

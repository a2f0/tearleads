import { expect, test } from "bun:test";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";
import {
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES,
} from "@symcrypt/validators/util";
import { limitDocumentSyncRequestBytes } from "../../sync/documentSyncOutgoingBatch";
import { submitDocumentSync } from "./syncResponses";
import type { DocumentSyncApi, DocumentSyncPlan } from "./types";

const DOCUMENT_ID = "document-1";

function contentKeyBundle(contentKeyEpoch: number) {
  return {
    contentKeyEpoch,
    documentId: DOCUMENT_ID,
    linkSetManifestHash: "manifest-1",
    targetHash: "targets-1",
    targets: [
      {
        containerId: "container-1",
        containerKeyEpoch: 1,
        containerKeyEpochId: "container-key-1",
        containerManifestHash: "container-manifest-1",
        wrappedKey: "wrapped-key",
        wrappingMetadata: {},
      },
    ],
  };
}

function response(input: {
  readonly commitLsn: string;
  readonly cursor: string | null;
  readonly updateId: string;
}): DocumentSyncResponse {
  const bundle = contentKeyBundle(1);
  return {
    acceptedOutgoingUpdateIds:
      input.updateId === "update-1" ? ["outgoing-1"] : [],
    commitLsn: input.commitLsn,
    commitLsnMode: "tracked",
    contentKeyBundle: bundle,
    contentKeyBundles: [bundle],
    documentId: DOCUMENT_ID,
    documentKekTargets: {
      documentId: DOCUMENT_ID,
      documentKeyTargetHash: "targets-1",
      linkedContainerKeyEpochIds: ["container-key-1"],
      linkedContainerManifestHashes: ["container-manifest-1"],
      linkSetManifestHash: "manifest-1",
      targets: [{}],
    },
    pullPage: {
      hasMore: input.cursor !== null,
      nextCursor: input.cursor,
    },
    updates: [{ id: input.updateId }] as DocumentSyncResponse["updates"],
  };
}

test("submitDocumentSync drains read-only continuation pages", async () => {
  const request: DocumentSyncRequest = {
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "manifest-1",
    expectedTargetHash: "targets-1",
    localVersionVector: null,
    minLsn: "0/1",
    outgoingUpdates: [
      { id: "outgoing-1" },
    ] as DocumentSyncRequest["outgoingUpdates"],
    supportsPullPagination: true,
    supportsUntrackedCommitLsn: true,
  };
  const plan = { documentId: DOCUMENT_ID, request } as DocumentSyncPlan;
  const pages = [
    response({ commitLsn: "0/2", cursor: "cursor-2", updateId: "update-1" }),
    response({ commitLsn: "0/3", cursor: null, updateId: "update-2" }),
  ];
  const requests: DocumentSyncRequest[] = [];
  const apiClient = {
    getDocumentWriterProjection: async () => null,
    syncDocument: async () => {
      throw new Error("Expected result-aware document sync");
    },
    syncDocumentResult: async (_documentId, nextRequest) => {
      requests.push(nextRequest);
      const nextPage = pages.shift();
      if (!nextPage) throw new Error("Unexpected document sync request");
      return { data: nextPage, ok: true as const };
    },
  } satisfies DocumentSyncApi;

  const result = await submitDocumentSync({ apiClient, plan });

  expect(result?.ok).toBe(true);
  if (!result?.ok) throw new Error("Expected successful paginated sync");
  expect(result.pullComplete).toBe(true);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toBe(request);
  expect(requests[1]).toEqual({
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "manifest-1",
    expectedTargetHash: "targets-1",
    localVersionVector: null,
    minLsn: "0/2",
    outgoingUpdates: [],
    pullCursor: "cursor-2",
    supportsPullPagination: true,
    supportsUntrackedCommitLsn: true,
  });
  expect(result.response.updates.map(({ id }) => id)).toEqual([
    "update-1",
    "update-2",
  ]);
  expect(result.response.acceptedOutgoingUpdateIds).toEqual(["outgoing-1"]);
  expect(result.response.contentKeyBundles).toHaveLength(1);
  expect(result.response.commitLsn).toBe("0/3");
  expect(result.response.pullPage).toEqual({
    hasMore: false,
    nextCursor: null,
  });
});

test("submitDocumentSync bounds an in-memory drain to two pages", async () => {
  const request: DocumentSyncRequest = {
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "manifest-1",
    expectedTargetHash: "targets-1",
    localVersionVector: null,
    outgoingUpdates: [],
    supportsPullPagination: true,
    supportsUntrackedCommitLsn: true,
  };
  const pages = [
    {
      ...response({
        commitLsn: "0/2",
        cursor: "cursor-2",
        updateId: "update-1",
      }),
      acceptedOutgoingUpdateIds: [],
    },
    response({ commitLsn: "0/3", cursor: "cursor-3", updateId: "update-2" }),
  ];
  const requests: DocumentSyncRequest[] = [];
  const apiClient = {
    getDocumentWriterProjection: async () => null,
    syncDocument: async () => null,
    syncDocumentResult: async (_documentId, nextRequest) => {
      requests.push(nextRequest);
      const nextPage = pages.shift();
      if (!nextPage) throw new Error("Unexpected document sync request");
      return { data: nextPage, ok: true as const };
    },
  } satisfies DocumentSyncApi;

  const result = await submitDocumentSync({
    apiClient,
    plan: { documentId: DOCUMENT_ID, request } as DocumentSyncPlan,
  });

  expect(result?.ok).toBe(true);
  if (!result?.ok) throw new Error("Expected a bounded partial pull");
  expect(result.pullComplete).toBe(false);
  expect(requests).toHaveLength(2);
  expect(result.response.updates.map(({ id }) => id)).toEqual([
    "update-1",
    "update-2",
  ]);
  expect(result.response.pullPage?.hasMore).toBe(true);
});

test("an oversized version vector resumes beyond the first 64 updates", async () => {
  const oversizedRequest: DocumentSyncRequest = {
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "manifest-1",
    expectedTargetHash: "targets-1",
    localVersionVector: "V".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES),
    outgoingUpdates: [],
    supportsPullPagination: true,
    supportsUntrackedCommitLsn: true,
  };
  const firstRequest = limitDocumentSyncRequestBytes(oversizedRequest);
  expect(firstRequest.localVersionVector).toBeNull();

  const firstPage = {
    ...response({
      commitLsn: "0/2",
      cursor: "cursor-65",
      updateId: "update-000",
    }),
    acceptedOutgoingUpdateIds: [],
    updates: Array.from(
      { length: MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES },
      (_, index) => ({ id: `update-${String(index).padStart(3, "0")}` }),
    ) as DocumentSyncResponse["updates"],
  };
  const requests: DocumentSyncRequest[] = [];
  const firstResult = await submitDocumentSync({
    apiClient: {
      getDocumentWriterProjection: async () => null,
      syncDocument: async () => null,
      syncDocumentResult: async (_documentId, request) => {
        requests.push(request);
        return { data: firstPage, ok: true as const };
      },
    },
    plan: {
      documentId: DOCUMENT_ID,
      request: firstRequest,
    } as DocumentSyncPlan,
  });
  expect(firstResult?.ok).toBe(true);
  if (!firstResult?.ok) throw new Error("Expected first bounded pull page");
  expect(firstResult.pullComplete).toBe(false);
  expect(requests).toHaveLength(1);

  const resumeCursor = firstResult.response.pullPage.nextCursor;
  if (resumeCursor === null) throw new Error("Expected a resume cursor");
  const resumedRequest: DocumentSyncRequest = {
    ...firstRequest,
    minLsn: firstResult.response.commitLsn ?? undefined,
    pullCursor: resumeCursor,
  };
  const finalPage = response({
    commitLsn: "0/3",
    cursor: null,
    updateId: "update-064",
  });
  const resumedResult = await submitDocumentSync({
    apiClient: {
      getDocumentWriterProjection: async () => null,
      syncDocument: async () => null,
      syncDocumentResult: async (_documentId, request) => {
        requests.push(request);
        return { data: finalPage, ok: true as const };
      },
    },
    plan: {
      documentId: DOCUMENT_ID,
      request: resumedRequest,
    } as DocumentSyncPlan,
  });

  expect(resumedResult?.ok).toBe(true);
  if (!resumedResult?.ok) throw new Error("Expected resumed pull to finish");
  expect(resumedResult.pullComplete).toBe(true);
  expect(requests[1]?.pullCursor).toBe("cursor-65");
  expect(resumedResult.response.updates.map(({ id }) => id)).toEqual([
    "update-064",
  ]);
});

test("submitDocumentSync preserves committed acknowledgements when a continuation fails", async () => {
  const request: DocumentSyncRequest = {
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "manifest-1",
    expectedTargetHash: "targets-1",
    localVersionVector: null,
    outgoingUpdates: [
      { id: "outgoing-1" },
    ] as DocumentSyncRequest["outgoingUpdates"],
    supportsPullPagination: true,
    supportsUntrackedCommitLsn: true,
  };
  const plan = { documentId: DOCUMENT_ID, request } as DocumentSyncPlan;
  const firstPage = response({
    commitLsn: "0/2",
    cursor: "cursor-2",
    updateId: "update-1",
  });
  let requestCount = 0;
  let reported = false;
  const apiClient = {
    getDocumentWriterProjection: async () => null,
    syncDocument: async () => {
      throw new Error("Expected result-aware document sync");
    },
    syncDocumentResult: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return { data: firstPage, ok: true as const };
      }
      return {
        message: "offline",
        ok: false as const,
        report: () => {
          reported = true;
        },
        status: null,
      };
    },
  } satisfies DocumentSyncApi;

  const result = await submitDocumentSync({ apiClient, plan });

  expect(result).toEqual({
    ok: true,
    pullComplete: false,
    response: firstPage,
  });
  expect(reported).toBe(true);
  expect(requestCount).toBe(2);
});

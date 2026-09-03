import { expect, test } from "bun:test";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import {
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES,
} from "@tearleads/validators/util";
import { limitDocumentSyncRequestBytes } from "../../sync/documentSyncOutgoingBatch";
import {
  readPullContinuation,
  resolvePullContinuationMinLsn,
} from "./syncPagination";
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

test("submitDocumentSync returns a completed single page", async () => {
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
  const plan = {
    documentId: DOCUMENT_ID,
    organizationId: "organization-1",
    request,
  } as DocumentSyncPlan;
  const page = response({
    commitLsn: "0/2",
    cursor: null,
    updateId: "update-1",
  });
  const requests: DocumentSyncRequest[] = [];
  const requestOptions: unknown[] = [];
  const apiClient = {
    getDocumentWriterProjection: async () => null,
    syncDocument: async () => {
      throw new Error("Expected result-aware document sync");
    },
    syncDocumentResult: async (_documentId, nextRequest, options) => {
      requests.push(nextRequest);
      requestOptions.push(options);
      return { data: page, ok: true as const };
    },
  } satisfies DocumentSyncApi;

  const result = await submitDocumentSync({ apiClient, plan });

  expect(result?.ok).toBe(true);
  if (!result?.ok) throw new Error("Expected successful paginated sync");
  expect(result.pullComplete).toBe(true);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toBe(request);
  expect(requestOptions).toEqual([
    {
      expectedPaymentRequiredOrganizationId: "organization-1",
      reportErrors: false,
    },
  ]);
  expect(result.response.updates.map(({ id }) => id)).toEqual(["update-1"]);
  expect(result.response.acceptedOutgoingUpdateIds).toEqual(["outgoing-1"]);
  expect(result.response.contentKeyBundles).toHaveLength(1);
  expect(result.response.commitLsn).toBe("0/2");
  expect(result.response.pullPage).toEqual({
    hasMore: false,
    nextCursor: null,
  });
});

test("submitDocumentSync returns one incomplete page for durable settlement", async () => {
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
  expect(requests).toHaveLength(1);
  expect(pages).toHaveLength(1);
  expect(result.response.updates.map(({ id }) => id)).toEqual(["update-1"]);
  expect(result.response.pullPage?.hasMore).toBe(true);
});

test("a cursor-bearing page requires a checkpoint before it can be applied", async () => {
  const page = {
    ...response({
      commitLsn: "0/2",
      cursor: "cursor-without-checkpoint",
      updateId: "untrusted-update",
    }),
    commitLsn: null,
  };
  const plan = {
    documentId: DOCUMENT_ID,
    request: {
      contentKeyEpoch: 1,
      expectedLinkSetManifestHash: "manifest-1",
      expectedTargetHash: "targets-1",
      localVersionVector: null,
      outgoingUpdates: [],
      supportsPullPagination: true,
      supportsUntrackedCommitLsn: true,
    },
  } as unknown as DocumentSyncPlan;

  await expect(
    submitDocumentSync({
      apiClient: {
        getDocumentWriterProjection: async () => null,
        syncDocument: async () => page,
      },
      plan,
    }),
  ).rejects.toThrow(
    "Document sync pull continuation is missing its checkpoint",
  );
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

  const pullContinuation = readPullContinuation(firstResult.response);
  expect(pullContinuation).toEqual({
    commitLsn: "0/2",
    commitLsnMode: "tracked",
    cursor: "cursor-65",
  });
  if (!pullContinuation) throw new Error("Expected a pull continuation");
  const resumedRequest: DocumentSyncRequest = {
    ...firstRequest,
    minLsn: resolvePullContinuationMinLsn(pullContinuation, undefined),
    pullCursor: pullContinuation.cursor,
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

test("a resumed pull retains its original commit LSN mode", async () => {
  const resumedRequest: DocumentSyncRequest = {
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "manifest-1",
    expectedTargetHash: "targets-1",
    localVersionVector: null,
    minLsn: "0/2",
    outgoingUpdates: [],
    pullCursor: "cursor-from-tracked-page",
    supportsPullPagination: true,
    supportsUntrackedCommitLsn: true,
  };
  const switchedMode = {
    ...response({
      commitLsn: "0/0",
      cursor: null,
      updateId: "update-after-resume",
    }),
    commitLsnMode: "untracked" as const,
  };

  await expect(
    submitDocumentSync({
      apiClient: {
        getDocumentWriterProjection: async () => null,
        syncDocument: async () => null,
        syncDocumentResult: async () => ({
          data: switchedMode,
          ok: true as const,
        }),
      },
      expectedCommitLsnMode: "tracked",
      plan: {
        documentId: DOCUMENT_ID,
        request: resumedRequest,
      } as DocumentSyncPlan,
    }),
  ).rejects.toThrow("Document sync continuation commit LSN mode changed");
});

test("pull continuations retain a valid mode-specific replica checkpoint", () => {
  expect(
    resolvePullContinuationMinLsn(
      {
        commitLsn: "0/2",
        commitLsnMode: "tracked",
        cursor: "tracked-page-2",
      },
      "0/3",
    ),
  ).toBe("0/3");
  expect(
    resolvePullContinuationMinLsn(
      {
        commitLsn: "0/0",
        commitLsnMode: "untracked",
        cursor: "untracked-page-2",
      },
      "0/3",
    ),
  ).toBe("0/0");
  expect(() =>
    readPullContinuation({
      ...response({
        commitLsn: "0/2",
        cursor: "cursor-without-checkpoint",
        updateId: "update-1",
      }),
      commitLsn: null,
    }),
  ).toThrow("pull continuation is missing its checkpoint");
});

test("submitDocumentSync reports a continuation-page failure directly", async () => {
  const request: DocumentSyncRequest = {
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "manifest-1",
    expectedTargetHash: "targets-1",
    localVersionVector: null,
    minLsn: "0/2",
    outgoingUpdates: [],
    pullCursor: "cursor-2",
    supportsPullPagination: true,
    supportsUntrackedCommitLsn: true,
  };
  const plan = { documentId: DOCUMENT_ID, request } as DocumentSyncPlan;
  let requestCount = 0;
  let reported = false;
  const apiClient = {
    getDocumentWriterProjection: async () => null,
    syncDocument: async () => {
      throw new Error("Expected result-aware document sync");
    },
    syncDocumentResult: async () => {
      requestCount += 1;
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

  expect(result?.ok).toBe(false);
  expect(reported).toBe(false);
  expect(requestCount).toBe(1);
});

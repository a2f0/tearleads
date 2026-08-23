import { expect, test } from "bun:test";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";
import { submitDocumentSync } from "./syncResponses";
import type { DocumentSyncApi, DocumentSyncPlan } from "./types";

const DOCUMENT_ID = "document-pagination-validation";

function page(input: {
  readonly commitLsn: string;
  readonly cursor?: string | null | undefined;
  readonly updateId?: string | undefined;
}): DocumentSyncResponse {
  const contentKeyBundle = {
    contentKeyEpoch: 1,
    documentId: DOCUMENT_ID,
    linkSetManifestHash: "manifest-1",
    targetHash: "targets-1",
    targets: [],
  };
  return {
    acceptedOutgoingUpdateIds: [],
    commitLsn: input.commitLsn,
    commitLsnMode: "tracked",
    contentKeyBundle,
    contentKeyBundles: [contentKeyBundle],
    documentId: DOCUMENT_ID,
    documentKekTargets: {
      documentId: DOCUMENT_ID,
      documentKeyTargetHash: "targets-1",
      linkedContainerKeyEpochIds: [],
      linkedContainerManifestHashes: [],
      linkSetManifestHash: "manifest-1",
      targets: [],
    },
    ...(input.cursor === undefined
      ? {}
      : {
          pullPage: {
            hasMore: input.cursor !== null,
            nextCursor: input.cursor,
          },
        }),
    updates:
      input.updateId === undefined
        ? []
        : ([{ id: input.updateId }] as DocumentSyncResponse["updates"]),
  } as DocumentSyncResponse;
}

function plan(): DocumentSyncPlan {
  return {
    documentId: DOCUMENT_ID,
    request: {
      contentKeyEpoch: 1,
      expectedLinkSetManifestHash: "manifest-1",
      expectedTargetHash: "targets-1",
      localVersionVector: null,
      minLsn: "0/1",
      outgoingUpdates: [],
      supportsPullPagination: true,
      supportsUntrackedCommitLsn: true,
    } satisfies DocumentSyncRequest,
  } as unknown as DocumentSyncPlan;
}

function apiWithResults(
  results: Array<
    | { readonly data: DocumentSyncResponse; readonly ok: true }
    | {
        readonly message: string;
        readonly ok: false;
        readonly report: () => void;
        readonly status: number | null;
      }
  >,
): DocumentSyncApi {
  return {
    getDocumentWriterProjection: async () => null,
    syncDocument: async () => null,
    syncDocumentResult: async () => {
      const result = results.shift();
      if (!result) throw new Error("Unexpected document sync request");
      return result;
    },
  };
}

test("an empty page followed by failure does not success-loop", async () => {
  const failure = {
    message: "offline",
    ok: false as const,
    report: () => undefined,
    status: null,
  };
  const result = await submitDocumentSync({
    apiClient: apiWithResults([
      { data: page({ commitLsn: "0/2", cursor: "cursor-2" }), ok: true },
      failure,
    ]),
    plan: plan(),
  });

  expect(result).toBe(failure);
});

test("a continuation without pull metadata is rejected", async () => {
  const submitted = submitDocumentSync({
    apiClient: apiWithResults([
      {
        data: page({
          commitLsn: "0/2",
          cursor: "cursor-2",
          updateId: "update-1",
        }),
        ok: true,
      },
      {
        data: page({ commitLsn: "0/3", updateId: "update-2" }),
        ok: true,
      },
    ]),
    plan: plan(),
  });

  await expect(submitted).rejects.toThrow(
    "Document sync response is missing pull page metadata",
  );
});

test("a continuation cannot regress its tracked commit checkpoint", async () => {
  const submitted = submitDocumentSync({
    apiClient: apiWithResults([
      {
        data: page({
          commitLsn: "0/3",
          cursor: "cursor-2",
          updateId: "update-1",
        }),
        ok: true,
      },
      {
        data: page({
          commitLsn: "0/2",
          cursor: null,
          updateId: "update-2",
        }),
        ok: true,
      },
    ]),
    plan: plan(),
  });

  await expect(submitted).rejects.toThrow(
    "Document sync continuation commit LSN regressed",
  );
});

test("the aggregate update cap stops before another continuation", async () => {
  const fullPage = {
    ...page({ commitLsn: "0/2", cursor: "cursor-2" }),
    updates: Array.from({ length: 64 }, (_, index) => ({
      id: `update-${index}`,
    })) as DocumentSyncResponse["updates"],
  };
  let requestCount = 0;
  const apiClient = {
    getDocumentWriterProjection: async () => null,
    syncDocument: async () => null,
    syncDocumentResult: async () => {
      requestCount += 1;
      return { data: fullPage, ok: true as const };
    },
  } satisfies DocumentSyncApi;

  const result = await submitDocumentSync({ apiClient, plan: plan() });

  expect(result?.ok).toBe(true);
  if (!result?.ok) throw new Error("Expected a bounded partial pull");
  expect(result.pullComplete).toBe(false);
  expect(result.response.updates).toHaveLength(64);
  expect(requestCount).toBe(1);
});

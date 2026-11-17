import { expect, test } from "bun:test";
import type { DocumentLinkAccessEventBody } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { DOCUMENT_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { createLinkSetResponseFromRequest } from "../../../../test/helpers/data/documentFixtures";
import {
  type LocalView,
  linkLegFixture,
  linkSetRefusal,
  seedLocalView,
} from "../../../../test/helpers/workflows/linkSetLegFixture";
import { createRemoteDocumentServiceFixture } from "../../../../test/helpers/workflows/remoteDocumentServiceFixture";
import type { DocumentLinkSetMutationFailure } from "../../../data/documents/shared/types";
import { documentMayHaveAttachments } from "../../../data/persistence/documents/documentAttachmentPresence";

const ATTACHMENTS_CHANGED: DocumentLinkSetMutationFailure = {
  code: DOCUMENT_MUTATION_ERROR_CODES.linkAttachmentsChanged,
  message:
    "Document attachments changed; retry the link with current blob keys",
  status: 409,
};

async function runLinkLeg(
  name: string,
  input: {
    readonly refusals: readonly DocumentLinkSetMutationFailure[];
    /** Envelopes a previous leg of the same move committed. */
    readonly committed?: DocumentLinkAccessEventBody["blobRewraps"];
    /** The retry's attachment listing fails as the operation ends. */
    readonly retryListingFailsAndEnds?: boolean;
    /** The retry's document projection read fails as the operation ends. */
    readonly retryProjectionFailsAndEnds?: boolean;
    /** The 1-based submission during which the operation stops being current. */
    readonly stopsBeingCurrentAt?: number;
    readonly view: LocalView;
  },
) {
  const leg = await linkLegFixture(name);
  const { close, execSql } = await createTestExecSql(name);
  const documentId = leg.writerProjection.documentId;
  await seedLocalView(execSql, documentId, input.view);
  const failures: DocumentLinkSetMutationFailure[] = [];
  const counts = {
    hostReports: 0,
    listings: 0,
    refreshedListings: 0,
    submissions: 0,
  };
  let current = true;
  let projectionReads = 0;
  try {
    const result = await createRemoteDocumentServiceFixture({
      api: createMockApiClient({
        listDocumentAttachments: async (_documentId, options) => {
          counts.listings += 1;
          if (options?.refresh) counts.refreshedListings += 1;
          if (!input.retryListingFailsAndEnds) return [];
          current = false;
          return null;
        },
        getContainerWriterProjection: async () => leg.sibling,
        getDocumentWriterProjection: async () => leg.writerProjection,
        getDocumentWriterProjectionResult: async () => {
          projectionReads += 1;
          if (!input.retryProjectionFailsAndEnds || projectionReads < 2)
            return { data: leg.writerProjection, ok: true as const };
          current = false;
          return linkSetRefusal(
            documentId,
            { code: undefined, message: "Unavailable", status: 503 },
            () => {
              counts.hostReports += 1;
            },
          );
        },
        primeDocumentWriterProjection: () => {},
        // Like the API client, a refusal reports itself unless asked not to.
        linkDocumentResult: async (requestDocumentId, request, options) => {
          const refusal = input.refusals[counts.submissions];
          counts.submissions += 1;
          if (counts.submissions === input.stopsBeingCurrentAt) current = false;
          if (refusal && options?.reportErrors !== false)
            counts.hostReports += 1;
          return refusal
            ? linkSetRefusal(requestDocumentId, refusal, () => {
                counts.hostReports += 1;
              })
            : {
                data: await createLinkSetResponseFromRequest(
                  requestDocumentId,
                  request,
                ),
                ok: true as const,
              };
        },
      }),
      encapsulationSecretKey: leg.keyPair.secretKey,
      execSql,
    }).relinkRemoteDocument({
      ...(input.committed === undefined
        ? {}
        : { attachmentReuse: { committed: input.committed } }),
      author: leg.author,
      documentId,
      onFailure: (failure) => failures.push(failure),
      operation: "link",
      resolveProjectionUserKey: leg.resolveProjectionUserKey,
      stillCurrent: () => current,
      targetContainerId: leg.sibling.containerId,
    });
    return { ...counts, failures, result };
  } finally {
    close();
  }
}

test("only a held document without a local attachment row skips the listing", async () => {
  const { close, execSql } = await createTestExecSql("attachment-presence");
  try {
    const answers: Record<string, boolean> = {};
    for (const view of [
      "absent",
      "empty",
      "held",
      "detached",
      "pending",
      "metadata",
    ] as const) {
      const documentId = `presence-${view}`;
      await seedLocalView(execSql, documentId, view);
      answers[view] = await documentMayHaveAttachments(execSql, documentId);
    }
    expect(answers).toEqual({
      absent: true,
      detached: true,
      empty: false,
      held: true,
      metadata: true,
      pending: true,
    });
  } finally {
    close();
  }
});

test("a link of a document with no local attachment cites none without listing", async () => {
  const run = await runLinkLeg("skipped-listing", {
    refusals: [],
    view: "empty",
  });
  expect(run).toMatchObject({ failures: [], listings: 0, submissions: 1 });
  expect(run.result).not.toBeNull();
});

test.each(["absent", "held", "detached", "pending"] as const)(
  "a link lists the attachments when the local view is %s",
  async (view) => {
    const run = await runLinkLeg(`listed-${view}`, { refusals: [], view });
    expect(run).toMatchObject({
      failures: [],
      listings: 1,
      refreshedListings: 0,
      submissions: 1,
    });
    expect(run.result).not.toBeNull();
  },
);

test("envelopes a later leg cannot re-cite make it list, not skip", async () => {
  // The previous leg wrapped this blob for another destination only.
  const run = await runLinkLeg("committed-not-reusable", {
    committed: [
      {
        blobId: "blob",
        contentKeyEpoch: 1,
        targets: [
          {
            bindingId: "binding",
            containerId: "elsewhere",
            containerKeyEpoch: 1,
            containerKeyEpochId: "elsewhere-epoch",
            containerManifestHash: "elsewhere-manifest",
            documentId: "document",
            wrappedKey: "key",
            wrappingMetadata: { iv: "iv", suite: "suite" },
          },
        ],
      },
    ],
    refusals: [],
    view: "empty",
  });
  expect(run).toMatchObject({ failures: [], listings: 1, submissions: 1 });
  expect(run.result).not.toBeNull();
});

test("a skipped listing the server refuses lists afresh and retries once", async () => {
  const run = await runLinkLeg("skipped-listing-refused", {
    refusals: [ATTACHMENTS_CHANGED],
    view: "empty",
  });
  // The recovered refusal reaches neither the caller nor the host reporter.
  expect(run).toMatchObject({
    failures: [],
    hostReports: 0,
    listings: 1,
    refreshedListings: 1,
    submissions: 2,
  });
  expect(run.result).not.toBeNull();
});

test("a refused retry is reported and not retried again", async () => {
  const run = await runLinkLeg("skipped-listing-refused-twice", {
    refusals: [ATTACHMENTS_CHANGED, ATTACHMENTS_CHANGED],
    view: "empty",
  });
  expect(run).toMatchObject({
    failures: [ATTACHMENTS_CHANGED],
    hostReports: 1,
    listings: 1,
    submissions: 2,
  });
  expect(run.result).toBeNull();
});

test("a refusal after the operation stopped being current is dropped", async () => {
  const run = await runLinkLeg("skipped-listing-refused-stale", {
    refusals: [ATTACHMENTS_CHANGED],
    stopsBeingCurrentAt: 1,
    view: "empty",
  });
  expect(run).toMatchObject({
    failures: [],
    hostReports: 0,
    listings: 0,
    submissions: 1,
  });
  expect(run.result).toBeNull();
});

test("a retry whose projection read fails after the operation ended is dropped", async () => {
  const run = await runLinkLeg("skipped-listing-retry-projection-stale", {
    refusals: [ATTACHMENTS_CHANGED],
    retryProjectionFailsAndEnds: true,
    view: "empty",
  });
  expect(run).toMatchObject({
    failures: [],
    hostReports: 0,
    listings: 0,
    submissions: 1,
  });
  expect(run.result).toBeNull();
});

test("a retry whose listing fails after the operation ended is dropped", async () => {
  const run = await runLinkLeg("skipped-listing-retry-listing-stale", {
    refusals: [ATTACHMENTS_CHANGED],
    retryListingFailsAndEnds: true,
    view: "empty",
  });
  expect(run).toMatchObject({
    failures: [],
    hostReports: 0,
    listings: 1,
    submissions: 1,
  });
  expect(run.result).toBeNull();
});

test("a retry refused after the operation stopped being current is dropped", async () => {
  const run = await runLinkLeg("skipped-listing-retry-stale", {
    refusals: [ATTACHMENTS_CHANGED, ATTACHMENTS_CHANGED],
    stopsBeingCurrentAt: 2,
    view: "empty",
  });
  expect(run).toMatchObject({
    failures: [],
    hostReports: 0,
    listings: 1,
    submissions: 2,
  });
  expect(run.result).toBeNull();
});

test("an uncoded refusal of a skipped listing lists and retries once", async () => {
  // A server without the code refuses an uncovered binding uncoded.
  const uncoded = { code: undefined, message: "Conflict", status: 409 };
  const run = await runLinkLeg("skipped-listing-uncoded-refusal", {
    refusals: [uncoded],
    view: "empty",
  });
  expect(run).toMatchObject({
    failures: [],
    hostReports: 0,
    listings: 1,
    submissions: 2,
  });
  expect(run.result).not.toBeNull();
});

test("a coded refusal of a skipped listing keeps its own recovery path", async () => {
  const unavailable = {
    code: "container_unavailable",
    message: "Container unavailable",
    status: 409,
  };
  const run = await runLinkLeg("skipped-listing-coded-refusal", {
    refusals: [unavailable],
    view: "empty",
  });
  expect(run).toMatchObject({
    failures: [unavailable],
    hostReports: 1,
    listings: 0,
    submissions: 1,
  });
  expect(run.result).toBeNull();
});

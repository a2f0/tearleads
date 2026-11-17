import { expect, test } from "bun:test";
import {
  type DocumentLinkAccessEventBody,
  normalizeDocumentAccessEventBody,
  readKeyingCanonicalJson,
} from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import {
  DOCUMENT_MUTATION_ERROR_CODES,
  type DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { createLinkSetResponseFromRequest } from "../../../../test/helpers/data/documentFixtures";
import {
  createBlobBytesResponse,
  createFixtureBinding,
  createUploadedAttachmentFixture,
} from "../../../../test/helpers/workflows/blobHydration";
import {
  bindingWithTargets,
  linkLegFixture,
  linkSetRefusal,
} from "../../../../test/helpers/workflows/linkSetLegFixture";
import { createRemoteDocumentServiceFixture } from "../../../../test/helpers/workflows/remoteDocumentServiceFixture";
import { DOCUMENTS_APP_KIND } from "../../../data/documents/documentConstants";
import type { DocumentLinkSetMutationFailure } from "../../../data/documents/shared/types";
import { readCanonicalRecord } from "../../../data/keying/canonicalJson";
import { documentMayHaveAttachments } from "../../../data/persistence/documents/documentAttachmentPresence";
import { ensureDocumentsSchema } from "../../../data/persistence/documents/internal/ensureDocumentsSchema";
import {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "../../../data/sqlite/schema/documentAttachmentSchema";
import { documents } from "../../../data/sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { decryptDocumentAttachmentBlob } from "../../blobs/hydration/decrypt";

type LocalView =
  | "absent"
  | "empty"
  | "held"
  | "detached"
  | "pending"
  | "metadata";

const ATTACHMENTS_CHANGED: DocumentLinkSetMutationFailure = {
  code: DOCUMENT_MUTATION_ERROR_CODES.linkAttachmentsChanged,
  message:
    "Document attachments changed; retry the link with current blob keys",
  status: 409,
};

async function seedLocalView(
  execSql: ExecSql,
  documentId: string,
  view: LocalView,
): Promise<void> {
  if (view === "absent") return;
  await ensureDocumentsSchema(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const localId = `${documentId}-local`;
  const now = new Date().toISOString();
  await db
    .insert(documents)
    .values({
      appKind: view === "metadata" ? "container-metadata" : DOCUMENTS_APP_KIND,
      documentId,
      localId,
      updatedAt: now,
    })
    .run();
  const attachment = {
    byteLength: 1,
    contentSha256: "digest",
    localId,
    mimeType: null,
    slotId: "slot",
    storageKey: `${localId}-bytes`,
  };
  if (view === "held" || view === "detached") {
    await db
      .insert(documentAttachmentBlobProjection)
      .values({
        ...attachment,
        blobId: "blob",
        detachedAt: view === "detached" ? now : null,
        updatedAt: now,
      })
      .run();
  }
  if (view === "pending") {
    await db
      .insert(documentPendingAttachments)
      .values({ ...attachment, createdAt: now, name: "file.txt" })
      .run();
  }
}

async function runLinkLeg(
  name: string,
  input: {
    readonly refusals: readonly DocumentLinkSetMutationFailure[];
    /** Envelopes a previous leg of the same move committed. */
    readonly committed?: DocumentLinkAccessEventBody["blobRewraps"];
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
          return [];
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

test("another refusal of a skipped listing keeps its own recovery path", async () => {
  const uncoded = { code: undefined, message: "Conflict", status: 409 };
  const run = await runLinkLeg("skipped-listing-other-refusal", {
    refusals: [uncoded],
    view: "empty",
  });
  expect(run).toMatchObject({
    failures: [uncoded],
    hostReports: 1,
    listings: 0,
    submissions: 1,
  });
  expect(run.result).toBeNull();
});

test("a stale empty view recovers with an envelope the destination can open", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const identity = await fixture.resolveProjectionUserKey(
    fixture.author.signerUserId,
  );
  if (!identity) throw new Error("Expected fixture identity");
  const destination = await createContainerWriterProjectionFixture({
    containerId: "stale-view-destination",
    encapsulationPublicKey: identity.encapsulationPublicKey,
    organizationId: fixture.author.organizationId,
    signerKeyFingerprint: fixture.author.signerKeyFingerprint,
    signerPrivateKey: fixture.author.signerPrivateKey,
    userId: fixture.author.signerUserId,
  });
  const documentId = fixture.writerProjection.documentId;
  // This device holds the document but never hydrated its attachment.
  await seedLocalView(fixture.execSql, documentId, "empty");
  const binding = createFixtureBinding(fixture);
  const signedRewraps: DocumentLinkAccessEventBody["blobRewraps"][] = [];
  const primed: DocumentWriterProjectionResponse[] = [];
  let listings = 0;
  const linked = await createRemoteDocumentServiceFixture({
    api: createMockApiClient({
      getBlobBytes: async (blobId) =>
        createBlobBytesResponse({
          blobId,
          encryptedBytes: fixture.stagedBlob.encryptedBytes,
          sha256: fixture.stagedBlob.sha256,
        }),
      getContainerWriterProjection: async () => destination,
      getDocumentWriterProjection: async () => fixture.writerProjection,
      listDocumentAttachments: async () => {
        listings += 1;
        return [binding];
      },
      // The server's binding check: the active binding must be cited.
      linkDocumentResult: async (requestDocumentId, request) => {
        const { blobRewraps } = normalizeDocumentAccessEventBody(
          readKeyingCanonicalJson(request.body, "link body"),
        );
        signedRewraps.push(blobRewraps);
        return blobRewraps.some((rewrap) => rewrap.blobId === binding.blobId)
          ? {
              data: await createLinkSetResponseFromRequest(
                requestDocumentId,
                request,
              ),
              ok: true as const,
            }
          : linkSetRefusal(requestDocumentId, ATTACHMENTS_CHANGED);
      },
      primeDocumentWriterProjection: (_id, projection) => {
        primed.push(projection);
      },
    }),
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  }).relinkRemoteDocument({
    author: fixture.author,
    documentId,
    operation: "link",
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetContainerId: destination.containerId,
  });
  if (!linked || !primed[0]) throw new Error("Expected the retried link");
  expect(listings).toBe(1);
  expect(signedRewraps.map((rewraps) => rewraps.length)).toEqual([0, 1]);
  const destinationTargets = (signedRewraps[1]?.[0]?.targets ?? []).filter(
    (target) => target.containerId === destination.containerId,
  );
  expect(destinationTargets).toHaveLength(1);
  const writerProjection = {
    ...primed[0],
    authorizingContainerPaths: [destination],
  };
  const destinationBinding = await bindingWithTargets(
    binding,
    writerProjection,
    destinationTargets.map((envelope) => ({
      ...envelope,
      wrappingMetadata: readCanonicalRecord(
        envelope.wrappingMetadata,
        "rewrap metadata",
      ),
    })),
  );
  const cold = await createTestExecSql("stale-view-destination-read");
  try {
    const bytes = await decryptDocumentAttachmentBlob({
      binding: destinationBinding,
      encryptedBytes: fixture.stagedBlob.encryptedBytes,
      expectedDocumentId: documentId,
      expectedSlotId: fixture.attachment.slotId,
      execSql: cold.execSql,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      writerProjection,
    });
    expect(Array.from(bytes)).toEqual(Array.from(fixture.bytes));
  } finally {
    cold.close();
  }
});

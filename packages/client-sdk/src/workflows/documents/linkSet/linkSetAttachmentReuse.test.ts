import { expect, test } from "bun:test";
import {
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
import { deriveDocumentTargetFromProjection } from "../../../data/documents/shared/projection";
import type { DocumentLinkSetMutationFailure } from "../../../data/documents/shared/types";
import { readCanonicalRecord } from "../../../data/keying/canonicalJson";
import { decryptDocumentAttachmentBlob } from "../../blobs/hydration/decrypt";
import {
  createLinkSetAttachmentReuse,
  reuseCommittedBlobRewraps,
} from "./linkSetBlobRewraps";

const target = (containerId: string) => ({
  containerId,
  containerKeyEpoch: 1,
  containerKeyEpochId: `${containerId}-epoch`,
  containerManifestHash: `${containerId}-manifest`,
});
const envelope = (bindingId: string, containerId: string) => ({
  ...target(containerId),
  bindingId,
  documentId: "document",
  wrappedKey: `${bindingId}-${containerId}-key`,
  wrappingMetadata: { iv: "iv", suite: "suite" },
});

test("a later leg re-cites the envelopes the previous leg committed", () => {
  const committed = [
    {
      blobId: "blob-b",
      contentKeyEpoch: 2,
      targets: [envelope("binding-b", "trash"), envelope("binding-b", "root")],
    },
    {
      blobId: "blob-a",
      contentKeyEpoch: 1,
      targets: [envelope("binding-a", "trash"), envelope("binding-a", "root")],
    },
  ];
  const reused = reuseCommittedBlobRewraps({
    committed,
    documentId: "document",
    targets: [target("trash")],
  });
  expect(reused).toEqual([
    {
      blobId: "blob-a",
      contentKeyEpoch: 1,
      targets: [envelope("binding-a", "trash")],
    },
    {
      blobId: "blob-b",
      contentKeyEpoch: 2,
      targets: [envelope("binding-b", "trash")],
    },
  ]);
  expect(
    reuseCommittedBlobRewraps({
      committed: [],
      documentId: "document",
      targets: [target("trash")],
    }),
  ).toEqual([]);
});

test("a target the previous leg never wrapped falls back to listing", () => {
  const committed = [
    { blobId: "blob", contentKeyEpoch: 1, targets: [envelope("b", "root")] },
  ];
  // A new destination, and an envelope scoped to another document, both need
  // the authenticated path: reuse never propagates a key to a new scope.
  expect(
    reuseCommittedBlobRewraps({
      committed,
      documentId: "document",
      targets: [target("trash")],
    }),
  ).toBeNull();
  expect(
    reuseCommittedBlobRewraps({
      committed,
      documentId: "other-document",
      targets: [target("root")],
    }),
  ).toBeNull();
});

async function runReusedLeg(
  name: string,
  refusal: DocumentLinkSetMutationFailure,
) {
  const leg = await linkLegFixture(name);
  const { close, execSql } = await createTestExecSql(name);
  const reuse = createLinkSetAttachmentReuse();
  reuse.committed = [];
  const failures: DocumentLinkSetMutationFailure[] = [];
  let listings = 0;
  let refreshedListings = 0;
  let submissions = 0;
  const result = await createRemoteDocumentServiceFixture({
    api: createMockApiClient({
      listDocumentAttachments: async (_documentId, options) => {
        listings += 1;
        if (options?.refresh) refreshedListings += 1;
        return [];
      },
      getContainerWriterProjection: async () => leg.sibling,
      getDocumentWriterProjection: async () => leg.writerProjection,
      primeDocumentWriterProjection: () => {},
      linkDocumentResult: async (documentId, request) => {
        submissions += 1;
        return submissions === 1
          ? linkSetRefusal(documentId, refusal)
          : {
              data: await createLinkSetResponseFromRequest(documentId, request),
              ok: true as const,
            };
      },
    }),
    encapsulationSecretKey: leg.keyPair.secretKey,
    execSql,
  }).relinkRemoteDocument({
    attachmentReuse: reuse,
    author: leg.author,
    documentId: leg.writerProjection.documentId,
    onFailure: (failure) => failures.push(failure),
    operation: "link",
    resolveProjectionUserKey: leg.resolveProjectionUserKey,
    targetContainerId: leg.sibling.containerId,
  });
  close();
  return { failures, listings, refreshedListings, result, reuse, submissions };
}

test.each([
  {
    code: DOCUMENT_MUTATION_ERROR_CODES.linkAttachmentsChanged,
    message:
      "Document attachments changed; retry the link with current blob keys",
    status: 409,
  },
  { code: undefined, message: "Blob content key epoch changed", status: 409 },
] satisfies DocumentLinkSetMutationFailure[])(
  "a reused leg the server refuses ($message) re-lists the attachments and retries once",
  async (refusal) => {
    const run = await runReusedLeg(
      `attachment-reuse-retry-${refusal.code ?? "uncoded"}`,
      refusal,
    );
    expect(run.submissions).toBe(2);
    expect(run.listings).toBe(1);
    expect(run.refreshedListings).toBe(1);
    expect(run.failures).toEqual([]);
    expect(run.result).not.toBeNull();
    expect(run.reuse.committed).toEqual([]);
  },
);

test("a coded refusal of a reused leg keeps its own recovery path", async () => {
  const refusal = {
    code: "container_unavailable",
    message: "targetContainerPathRefs[0] container unavailable",
    status: 409,
  } as const;
  const run = await runReusedLeg("attachment-reuse-coded", refusal);
  expect(run.submissions).toBe(1);
  expect(run.listings).toBe(0);
  expect(run.failures).toEqual([refusal]);
  expect(run.result).toBeNull();
  expect(run.reuse.committed).toBeNull();
});

test("an unlink leg re-cites the link leg's attachment wrap, usable with only the destination KEK", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const identity = await fixture.resolveProjectionUserKey(
    fixture.author.signerUserId,
  );
  if (!identity) throw new Error("Expected fixture identity");
  const destination = await createContainerWriterProjectionFixture({
    containerId: "reuse-destination",
    encapsulationPublicKey: identity.encapsulationPublicKey,
    organizationId: fixture.author.organizationId,
    signerKeyFingerprint: fixture.author.signerKeyFingerprint,
    signerPrivateKey: fixture.author.signerPrivateKey,
    userId: fixture.author.signerUserId,
  });
  const binding = createFixtureBinding(fixture);
  const reuse = createLinkSetAttachmentReuse();
  const primed: DocumentWriterProjectionResponse[] = [];
  let listings = 0;
  const linked = await createRemoteDocumentServiceFixture({
    api: createMockApiClient({
      getContainerWriterProjection: async () => destination,
      getDocumentWriterProjection: async () => fixture.writerProjection,
      listDocumentAttachments: async () => {
        listings += 1;
        return [binding];
      },
      getBlobBytes: async (blobId) =>
        createBlobBytesResponse({
          blobId,
          encryptedBytes: fixture.stagedBlob.encryptedBytes,
          sha256: fixture.stagedBlob.sha256,
        }),
      linkDocument: async (documentId, request) =>
        createLinkSetResponseFromRequest(documentId, request),
      primeDocumentWriterProjection: (_id, projection) => {
        primed.push(projection);
      },
    }),
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  }).relinkRemoteDocument({
    attachmentReuse: reuse,
    author: fixture.author,
    documentId: fixture.writerProjection.documentId,
    operation: "link",
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetContainerId: destination.containerId,
  });
  if (!linked || !primed[0] || !reuse.committed)
    throw new Error("Expected a committed link leg");
  expect(listings).toBe(1);
  const body = normalizeDocumentAccessEventBody(
    readKeyingCanonicalJson(linked.plan.request.body, "link body"),
  );
  // What the leg recorded is exactly what it signed.
  expect(reuse.committed).toEqual(body.blobRewraps);

  // The unlink leg keeps only the destination; it re-cites that wrap.
  const reused = reuseCommittedBlobRewraps({
    committed: reuse.committed,
    documentId: fixture.writerProjection.documentId,
    targets: [deriveDocumentTargetFromProjection(destination)],
  });
  const rewrap = reused?.[0];
  if (!rewrap) throw new Error("Expected a reused attachment rewrap");
  expect(rewrap.targets).toHaveLength(1);
  expect(rewrap.targets[0]?.containerId).toBe(destination.containerId);
  const writerProjection = {
    ...primed[0],
    authorizingContainerPaths: [destination],
  };
  const unlinkedBinding = await bindingWithTargets(
    binding,
    writerProjection,
    rewrap.targets.map((envelope) => ({
      ...envelope,
      wrappingMetadata: readCanonicalRecord(
        envelope.wrappingMetadata,
        "rewrap metadata",
      ),
    })),
  );
  const cold = await createTestExecSql("reuse-attachment-destination");
  try {
    const bytes = await decryptDocumentAttachmentBlob({
      binding: unlinkedBinding,
      encryptedBytes: fixture.stagedBlob.encryptedBytes,
      expectedDocumentId: fixture.writerProjection.documentId,
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

import { expect, test } from "bun:test";
import {
  computeBlobAccessManifestHash,
  computeBlobContentKeyTargetHash,
  generateKemSeedAndKeyPair,
  normalizeDocumentAccessEventBody,
  readKeyingCanonicalJson,
} from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import type {
  BlobAttachmentSummary,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  createBlobBytesResponse,
  createFixtureBinding,
  createUploadedAttachmentFixture,
} from "../../../../test/helpers/blobHydration";
import {
  createAuthor,
  createLinkSetResponseFromRequest,
  createResponse,
  writerProjectionEvidence,
} from "../../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { contentKeyTargetReference } from "../../../data/blobs/attachments/readers";
import { deriveDocumentTargetFromProjection } from "../../../data/documents/shared/projection";
import type { DocumentLinkSetMutationFailure } from "../../../data/documents/shared/types";
import { readCanonicalRecord } from "../../../data/keying/canonicalJson";
import { decryptDocumentAttachmentBlob } from "../../blobs/hydration/decrypt";
import { buildMaterializedDocumentCreatePlan } from "../create";
import {
  createLinkSetAttachmentReuse,
  reuseCommittedBlobRewraps,
} from "./linkSetBlobRewraps";
import { relinkRemoteDocument } from "./linkSetRemote";

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

async function linkLegFixture(name: string) {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const fixture = {
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: "reuse-organization",
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  };
  const projection = await createContainerWriterProjectionFixture({
    ...fixture,
    containerId: `${name}-root`,
  });
  const sibling = await createContainerWriterProjectionFixture({
    ...fixture,
    containerId: `${name}-sibling`,
    parentProjection: projection,
  });
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: `${name}-document`,
    targetSecretKey: keyPair.secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(created.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    ...writerProjectionEvidence([projection], []),
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };
  return {
    author,
    keyPair,
    resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: keyPair.publicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    }),
    sibling,
    writerProjection,
  };
}

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
  let submissions = 0;
  const result = await relinkRemoteDocument({
    apiClient: createMockApiClient({
      listDocumentAttachments: async () => {
        listings += 1;
        return [];
      },
      getContainerWriterProjection: async () => leg.sibling,
      getDocumentWriterProjection: async () => leg.writerProjection,
      primeDocumentWriterProjection: () => {},
      linkDocumentResult: async (documentId, request) => {
        submissions += 1;
        return submissions === 1
          ? {
              ...refusal,
              kind: "http" as const,
              method: "POST" as const,
              ok: false as const,
              path: `/documents/${documentId}/link`,
              report: () => {},
              statusText: "Conflict",
            }
          : {
              data: await createLinkSetResponseFromRequest(documentId, request),
              ok: true as const,
            };
      },
    }),
    attachmentReuse: reuse,
    author: leg.author,
    documentId: leg.writerProjection.documentId,
    execSql,
    onFailure: (failure) => failures.push(failure),
    operation: "link",
    resolveProjectionUserKey: leg.resolveProjectionUserKey,
    targetContainerId: leg.sibling.containerId,
    targetSecretKey: leg.keyPair.secretKey,
  });
  close();
  return { failures, listings, result, reuse, submissions };
}

test("a reused leg the server refuses re-lists the attachments and retries once", async () => {
  const run = await runReusedLeg("attachment-reuse-retry", {
    code: undefined,
    message:
      "Document attachments changed; retry the link with current blob keys",
    status: 409,
  });
  expect(run.submissions).toBe(2);
  expect(run.listings).toBe(1);
  expect(run.failures).toEqual([]);
  expect(run.result).not.toBeNull();
  expect(run.reuse.committed).toEqual([]);
});

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

async function bindingWithTargets(
  binding: BlobAttachmentSummary,
  projection: DocumentWriterProjectionResponse,
  targets: BlobAttachmentSummary["contentKeyBundle"]["targets"],
): Promise<BlobAttachmentSummary> {
  const references = targets.map(contentKeyTargetReference);
  const targetHash = await computeBlobContentKeyTargetHash(references);
  const current = {
    ...binding.blobKekTargets,
    documentManifestHashes: [projection.documentManifest.manifestHash],
    linkedContainerManifestHashes: references
      .map((target) => target.containerManifestHash)
      .sort(),
    linkedContainerKeyEpochIds: references
      .map((target) => target.containerKeyEpochId)
      .sort(),
    targets: references.map((target) => ({ ...target })),
    blobKeyTargetHash: targetHash,
  };
  const { targets: _targets, blobAccessManifestHash: _old, ...rest } = current;
  return {
    ...binding,
    blobKekTargets: {
      ...current,
      blobAccessManifestHash: await computeBlobAccessManifestHash({
        version: 1,
        ...rest,
      }),
    },
    contentKeyBundle: { ...binding.contentKeyBundle, targetHash, targets },
  };
}

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
  const linked = await relinkRemoteDocument({
    apiClient: createMockApiClient({
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
    attachmentReuse: reuse,
    author: fixture.author,
    documentId: fixture.writerProjection.documentId,
    execSql: fixture.execSql,
    operation: "link",
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetContainerId: destination.containerId,
    targetSecretKey: fixture.secretKey,
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

import { afterEach, beforeEach, expect, test } from "bun:test";
import { type AccessEvent, generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
  substituteFirstProjectionUserWrapMaterial,
} from "../../../../test/helpers/containerFixtures";
import {
  createAuthor,
  createLinkSetResponseFromRequest,
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createResponse,
  writerProjectionEvidence,
} from "../../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  buildMaterializedDocumentCreatePlan,
  buildMaterializedDocumentLinkSetMutationPlan,
} from "../index";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql("document-sync"));
  await ensureDocumentTables(execSql);
});

afterEach(() => closeExecSql());

interface ContentRecordFields {
  ciphertext?: unknown;
  contentRecordId?: unknown;
  iv?: unknown;
  nonceDomainHash?: unknown;
}

test("buildMaterializedDocumentSyncPlan rejects document writer projections with bad signatures", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "verified-container",
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const materializedCreate = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    documentId: "550e8400-e29b-41d4-a716-446655440099",
    eventId: "event-bad-document-signature",
    execSql,
    resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: encapsulationKeyPair.publicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    }),
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  const response = createResponse(materializedCreate.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    documentId: response.id,
    documentManifest: response.accessManifest,
    ...writerProjectionEvidence([projection], []),
    documentKekTargets: response.documentKekTargets,
    contentKeyBundle: response.contentKeyBundle,
    authorizingContainerPaths: [projection],
  };
  const signedEvent = writerProjection.documentManifest.event
    .event as unknown as AccessEvent;
  const signature = signedEvent.signature;
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("Expected signed document event fixture");
  }

  await expect(
    buildMaterializedDocumentSyncPlan({
      author,
      execSql,
      localVersionVector: null,
      pendingUpdates: [createPendingUpdateRecord()],
      resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
        encapsulationPublicKey: encapsulationKeyPair.publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey,
        userId: author.signerUserId,
      }),
      targetSecretKey: encapsulationKeyPair.secretKey,
      writerProjection: {
        ...writerProjection,
        documentManifest: {
          ...writerProjection.documentManifest,
          event: {
            ...writerProjection.documentManifest.event,
            event: {
              ...signedEvent,
              signature: `${signature.slice(0, -1)}${
                signature.endsWith("A") ? "B" : "A"
              }`,
            },
          },
        },
      },
    }),
  ).rejects.toMatchObject({ code: "signature_mismatch" });
});

test("buildMaterializedDocumentSyncPlan rejects substituted KEK material before encrypting updates", async () => {
  const parent = await createParentProjection();
  const resolveProjectionUserKey =
    createParentProjectionUserKeyResolver(parent);
  const materializedCreate = await buildMaterializedDocumentCreatePlan({
    author: parent.author,
    containerProjection: parent.projection,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    documentId: "550e8400-e29b-41d4-a716-446655440111",
    eventId: "event-substituted-kek-sync",
    execSql,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: parent.secretKey,
  });
  const response = createResponse(materializedCreate.plan);
  const tamperedProjection = await substituteFirstProjectionUserWrapMaterial({
    projection: parent.projection,
    publicKey: parent.encapsulationPublicKey,
    userId: parent.userId,
  });
  const writerProjection: DocumentWriterProjectionResponse = {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    authorizingContainerPaths: [tamperedProjection],
    contentKeyBundle: response.contentKeyBundle,
    ...writerProjectionEvidence([tamperedProjection], []),
    documentId: response.id,
    documentKekTargets: response.documentKekTargets,
    documentManifest: response.accessManifest,
  };

  await expect(
    buildMaterializedDocumentSyncPlan({
      author: parent.author,
      execSql,
      localVersionVector: null,
      pendingUpdates: [createPendingUpdateRecord()],
      resolveProjectionUserKey,
      targetSecretKey: parent.secretKey,
      writerProjection,
    }),
  ).rejects.toThrow("KEK material does not match committed epoch id");
});

// Regression for sharing manifest verification across the consistency and
// content-key unwrap passes (issue #1040 / scrub finding #5).
test("buildMaterializedDocumentSyncPlan verifies each authorizing path once across both passes", async () => {
  const parent = await createParentProjection();
  const baseResolver = createParentProjectionUserKeyResolver(parent);
  let signerKeyResolutions = 0;
  const countingResolver = async (userId: string) => {
    signerKeyResolutions += 1;
    return baseResolver(userId);
  };

  const materializedCreate = await buildMaterializedDocumentCreatePlan({
    author: parent.author,
    containerProjection: parent.projection,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    documentId: "550e8400-e29b-41d4-a716-446655440122",
    eventId: "event-single-verify-sync",
    execSql,
    resolveProjectionUserKey: countingResolver,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: parent.secretKey,
  });
  const response = createResponse(materializedCreate.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    authorizingContainerPaths: [parent.projection],
    contentKeyBundle: response.contentKeyBundle,
    ...writerProjectionEvidence([parent.projection], []),
    documentId: response.id,
    documentKekTargets: response.documentKekTargets,
    documentManifest: response.accessManifest,
  };

  signerKeyResolutions = 0;
  await buildMaterializedDocumentSyncPlan({
    author: parent.author,
    execSql,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey: countingResolver,
    targetSecretKey: parent.secretKey,
    writerProjection,
  });

  // With the shared verification cache the unwrap pass reuses the consistency
  // pass's verified container manifests instead of re-verifying them. For this
  // fixture that lowers signer-key resolutions from 5 (un-cached two-pass build)
  // to 4; the saving grows with container-path depth, where the same manifests
  // recur across passes. Pinning the count guards against the cache threading
  // being dropped (which would push this back to 5).
  expect(signerKeyResolutions).toBe(4);
});

test("buildMaterializedDocumentSyncPlan verifies linked document manifest history", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const rootProjection = await createContainerWriterProjectionFixture({
    containerId: "verified-root-container",
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const childProjection = await createContainerWriterProjectionFixture({
    containerId: "verified-child-container",
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    organizationId: author.organizationId,
    parentProjection: rootProjection,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const materializedCreate = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: rootProjection,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    documentId: "550e8400-e29b-41d4-a716-446655440098",
    eventId: "event-verified-document-history",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: encapsulationKeyPair.secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(materializedCreate.plan);
  const initialWriterProjection: DocumentWriterProjectionResponse = {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    documentId: createdResponse.id,
    documentManifest: createdResponse.accessManifest,
    ...writerProjectionEvidence([rootProjection], []),
    documentKekTargets: createdResponse.documentKekTargets,
    contentKeyBundle: createdResponse.contentKeyBundle,
    authorizingContainerPaths: [rootProjection],
  };
  const linked = await buildMaterializedDocumentLinkSetMutationPlan({
    prepareBlobRewraps: async () => [],
    author,
    operation: "link",
    targetContainerProjection: childProjection,
    targetSecretKey: encapsulationKeyPair.secretKey,
    trustedLocalProjection: true,
    writerProjection: initialWriterProjection,
  });
  const linkResponse = await createLinkSetResponseFromRequest(
    createdResponse.id,
    linked.plan.request,
  );
  const resolveProjectionUserKey = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: author.signerUserId,
  });

  await expect(
    buildMaterializedDocumentSyncPlan({
      author,
      execSql,
      localVersionVector: null,
      pendingUpdates: [createPendingUpdateRecord()],
      resolveProjectionUserKey,
      targetSecretKey: encapsulationKeyPair.secretKey,
      writerProjection: {
        policyEvidence: {
          organization: null,
          organizationPayloads: [],
          groups: [],
        },
        documentId: linkResponse.id,
        documentManifest: linkResponse.accessManifest,
        ...writerProjectionEvidence([rootProjection, childProjection], []),
        documentKekTargets: linkResponse.documentKekTargets,
        contentKeyBundle: linkResponse.contentKeyBundle,
        authorizingContainerPaths: [rootProjection, childProjection],
      },
    }),
  ).rejects.toThrow("Document writer projection previous manifest");

  const syncPlan = await buildMaterializedDocumentSyncPlan({
    author,
    execSql,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
    writerProjection: {
      policyEvidence: {
        organization: null,
        organizationPayloads: [],
        groups: [],
      },
      documentId: linkResponse.id,
      documentManifest: linkResponse.accessManifest,
      documentManifestHistory: [createdResponse.accessManifest],
      documentManifestContainerPaths: [
        rootProjection.path,
        childProjection.path,
      ],
      documentContainerManifestHistory: [
        ...rootProjection.path,
        ...childProjection.path,
      ],
      documentKekTargets: linkResponse.documentKekTargets,
      contentKeyBundle: linkResponse.contentKeyBundle,
      authorizingContainerPaths: [rootProjection, childProjection],
    },
  });

  expect(syncPlan.plan.documentManifest.manifestHash).toBe(
    linkResponse.accessManifest.manifestHash,
  );
});

test("buildMaterializedDocumentSyncPlan uses a fresh IV for same-domain re-encryption", async () => {
  const { author, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const sharedUpdate = createPendingUpdateRecord({
    updateData: bytesToBase64(new TextEncoder().encode("first payload")),
  });
  const first = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [sharedUpdate],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const second = await buildMaterializedDocumentSyncPlan({
    author,
    localVersionVector: null,
    pendingUpdates: [
      {
        ...sharedUpdate,
        updateData: bytesToBase64(new TextEncoder().encode("second payload")),
      },
    ],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const firstRecord = JSON.parse(
    first.plan.request.outgoingUpdates[0]?.encryptedData ?? "{}",
  ) as ContentRecordFields;
  const secondRecord = JSON.parse(
    second.plan.request.outgoingUpdates[0]?.encryptedData ?? "{}",
  ) as ContentRecordFields;

  expect(firstRecord.contentRecordId).toBe(sharedUpdate.id);
  expect(secondRecord.contentRecordId).toBe(sharedUpdate.id);
  expect(firstRecord.nonceDomainHash).toBe(secondRecord.nonceDomainHash);
  expect(firstRecord.iv).not.toBe(bytesToBase64(new Uint8Array(12)));
  expect(secondRecord.iv).not.toBe(bytesToBase64(new Uint8Array(12)));
  expect(firstRecord.iv).not.toBe(secondRecord.iv);
  expect(firstRecord.ciphertext).not.toBe(secondRecord.ciphertext);
});

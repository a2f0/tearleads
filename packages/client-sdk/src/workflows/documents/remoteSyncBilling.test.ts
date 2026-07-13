import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import {
  createAuthor,
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
} from "../../../test/helpers/documentFixtures";
import { createRemoteDocument } from "./create";
import { buildDocumentSyncPlan, syncRemoteDocument } from "./sync";

test("createRemoteDocument gates writes by the resolved container organization", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const customOrganizationId = "custom-organization";
  const projection = await createContainerWriterProjectionFixture({
    containerId: "blocked-custom-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: customOrganizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const checkedOrganizationIds: string[] = [];
  let submissionCount = 0;

  const created = await createRemoteDocument({
    apiClient: {
      createDocument: async () => {
        submissionCount += 1;
        return null;
      },
      getContainerWriterProjection: async () => projection,
      primeDocumentWriterProjection: () => undefined,
    },
    author,
    containerId: projection.containerId,
    documentId: "blocked-custom-document",
    isRemoteSyncBlocked: (organizationId) => {
      checkedOrganizationIds.push(organizationId);
      return organizationId === customOrganizationId;
    },
    resolveProjectionUserKey: async (userId) =>
      userId === author.signerUserId
        ? {
            encapsulationPublicKey: keyPair.publicKey,
            signingPublicKey,
            userId,
          }
        : null,
    targetSecretKey: keyPair.secretKey,
  });

  expect(author.organizationId).not.toBe(customOrganizationId);
  expect(checkedOrganizationIds).toEqual([customOrganizationId]);
  expect(submissionCount).toBe(0);
  expect(created).toBeNull();
});

test("syncRemoteDocument gates outgoing writes by the verified document plan organization", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const checkedOrganizationIds: string[] = [];
  let submissionCount = 0;

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => writerProjection,
      syncDocument: async () => {
        submissionCount += 1;
        return null;
      },
    },
    author,
    documentId: writerProjection.documentId,
    isRemoteSyncBlocked: (organizationId) => {
      checkedOrganizationIds.push(organizationId);
      return true;
    },
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    writerProjection,
  });

  expect(checkedOrganizationIds).toEqual([author.organizationId]);
  expect(submissionCount).toBe(0);
  expect(synced).toBeNull();
});

test("syncRemoteDocument still submits clean read-only probes for a blocked organization", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  let blockCheckCount = 0;
  let submissionCount = 0;

  const synced = await syncRemoteDocument({
    apiClient: {
      getDocumentWriterProjection: async () => writerProjection,
      syncDocument: async (documentId, request) => {
        submissionCount += 1;
        const plan = await buildDocumentSyncPlan({
          author,
          contentKeyBundle: writerProjection.contentKeyBundle,
          documentId,
          documentKekTargets: writerProjection.documentKekTargets,
          documentManifest: writerProjection.documentManifest,
          localVersionVector: null,
        });
        return createSyncResponse({ ...plan, request });
      },
    },
    author,
    documentId: writerProjection.documentId,
    isRemoteSyncBlocked: () => {
      blockCheckCount += 1;
      return true;
    },
    localVersionVector: null,
    pendingUpdates: [],
    persistedState: {
      contentKeyBundle: JSON.stringify(writerProjection.contentKeyBundle),
      documentId: writerProjection.documentId,
      documentKekTargets: JSON.stringify(writerProjection.documentKekTargets),
      documentManifestBundle: JSON.stringify(writerProjection.documentManifest),
    },
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
  });

  expect(blockCheckCount).toBe(0);
  expect(submissionCount).toBe(1);
  expect(synced).not.toBeNull();
});

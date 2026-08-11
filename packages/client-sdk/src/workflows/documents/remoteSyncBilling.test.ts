import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import {
  createAuthor,
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../test/helpers/trustedUserIdentity";
import { createRemoteDocument } from "./create";
import { syncRemoteDocument } from "./sync";
import { buildDocumentSyncPlan } from "./syncPlanIdentity";

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
  const { close, execSql } = await createTestExecSql(
    "blocked-remote-document-create",
  );

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
    execSql,
    isRemoteSyncBlocked: (organizationId) => {
      checkedOrganizationIds.push(organizationId);
      return organizationId === customOrganizationId;
    },
    resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: keyPair.publicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    }),
    targetSecretKey: keyPair.secretKey,
  });

  expect(author.organizationId).not.toBe(customOrganizationId);
  expect(checkedOrganizationIds).toEqual([customOrganizationId]);
  expect(submissionCount).toBe(0);
  expect(created).toBeNull();
  close();
});

test("syncRemoteDocument gates outgoing writes by the verified document plan organization", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql("blocked-document-sync");
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
    execSql,
    isRemoteSyncBlocked: (organizationId) => {
      checkedOrganizationIds.push(organizationId);
      return true;
    },
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
    targetSecretKey: secretKey,
    writerProjection,
  });
  close();

  expect(checkedOrganizationIds).toEqual([author.organizationId]);
  expect(submissionCount).toBe(0);
  expect(synced).toBeNull();
});

test("syncRemoteDocument still submits clean read-only probes for a blocked organization", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    "blocked-read-only-document-sync",
  );
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
    execSql,
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
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
    targetSecretKey: secretKey,
  });

  expect(blockCheckCount).toBe(0);
  expect(submissionCount).toBe(1);
  expect(synced).not.toBeNull();
  close();
});

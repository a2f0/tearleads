import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import { createAuthor } from "../../../test/helpers/documentFixturePrimitives";
import { createResponseFromRequest } from "../../../test/helpers/documentResponseFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../test/helpers/trustedUserIdentity";
import { loadAccessManifestCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createRemoteDocument } from "./create";

test("document create guards projection verification after generation expiry", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "document-create-generation-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const resolveTrustedIdentity = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: keyPair.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: author.signerUserId,
  });
  const database = await createTestExecSql(
    "document-create-projection-generation",
  );
  let submitted = false;
  let current = true;
  let primed = false;

  try {
    const created = await createRemoteDocument({
      apiClient: {
        createDocument: async (request) => {
          submitted = true;
          return createResponseFromRequest(request);
        },
        getContainerWriterProjection: async () => projection,
        primeDocumentWriterProjection: () => {
          primed = true;
        },
      },
      author,
      containerId: projection.containerId,
      documentId: "document-create-expired-verification",
      execSql: database.execSql,
      resolveProjectionUserKey: async (userId) => {
        const identity = await resolveTrustedIdentity(userId);
        if (submitted) current = false;
        return identity;
      },
      stillCurrent: () => current,
      targetSecretKey: keyPair.secretKey,
    });

    expect(created).toBeNull();
    expect(current).toBe(false);
    expect(primed).toBe(false);
  } finally {
    database.close();
  }
});

test("document create planning rolls back checkpoints after generation expiry", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "document-create-expired-planning-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const database = await createTestExecSql(
    "document-create-planning-generation",
  );
  let submitted = false;
  let transactionStarted = false;
  const guardedExecSql = (async (...args: Parameters<ExecSql>) => {
    const rows = await database.execSql(...args);
    if (args[0].trim().toUpperCase().startsWith("BEGIN")) {
      transactionStarted = true;
    }
    return rows;
  }) as ExecSql;

  try {
    const created = await createRemoteDocument({
      apiClient: {
        createDocument: async () => {
          submitted = true;
          throw new Error("expired document create must not submit");
        },
        getContainerWriterProjection: async () => projection,
        primeDocumentWriterProjection: () => {},
      },
      author,
      containerId: projection.containerId,
      documentId: "document-create-expired-planning",
      execSql: guardedExecSql,
      resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
        encapsulationPublicKey: keyPair.publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey,
        userId: author.signerUserId,
      }),
      stillCurrent: () => !transactionStarted,
      targetSecretKey: keyPair.secretKey,
    });

    expect(created).toBeNull();
    expect(transactionStarted).toBe(true);
    expect(submitted).toBe(false);
    await expect(
      loadAccessManifestCheckpoint(
        database.execSql,
        "container",
        projection.organizationId,
        projection.containerId,
      ),
    ).resolves.toBeNull();
  } finally {
    database.close();
  }
});

import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import { createAuthor } from "../../../test/helpers/documentFixturePrimitives";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../test/helpers/trustedUserIdentity";
import type { ExecSql } from "../sqlite/sqlSchema";
import { verifyContainerDestinationProjection } from "./containerDestinationVerification";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  verifyContainerWriterProjection,
} from "./containerProjectionVerification";
import {
  verifyDocumentWriterProjection,
  verifyDocumentWriterProjectionAuthorization,
} from "./documentProjectionVerification";
import { ProjectionVerificationCancelledError } from "./types";
import { BUNDLE_RETENTION_DEADLINE_MS } from "./verifiedProjectionBundles";

/**
 * An executor whose generation expires while the verified-bundle cache write
 * is in flight: every check before that write passes.
 */
async function expiringDuringBundleWrite(name: string) {
  const database = await createTestExecSql(name);
  let expired = false;
  const execSql = (async (...args: Parameters<ExecSql>) => {
    if (args[0].includes("verified_access_manifest_bundles")) expired = true;
    return database.execSql(...args);
  }) as ExecSql;
  return {
    close: () => database.close(),
    execSql,
    stillCurrent: () => !expired,
  };
}

async function containerFixture() {
  const { author, signingPublicKey } = await createAuthor();
  const encapsulationPublicKey = generateKemSeedAndKeyPair().publicKey;
  return {
    projection: await createContainerWriterProjectionFixture({
      containerId: "expiring-container",
      encapsulationPublicKey,
      organizationId: author.organizationId,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    }),
    resolveUserKey: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    }),
  };
}

const containerVerifiers = [
  ["projection", verifyContainerWriterProjection],
  ["policy collection", collectContainerWriterProjectionPrincipalPolicies],
  ["destination", verifyContainerDestinationProjection],
] as const;

for (const [entry, verify] of containerVerifiers) {
  test(`container ${entry} verification expires during its bundle write`, async () => {
    const fixture = await containerFixture();
    const database = await expiringDuringBundleWrite(
      `expiring-bundle-write-container-${entry}`,
    );
    try {
      await expect(
        verify({
          execSql: database.execSql,
          projection: fixture.projection,
          resolveUserKey: fixture.resolveUserKey,
          stillCurrent: database.stillCurrent,
        }),
      ).rejects.toBeInstanceOf(ProjectionVerificationCancelledError);
      expect(database.stillCurrent()).toBe(false);
    } finally {
      database.close();
    }
  });
}

const documentVerifiers = [
  ["head", verifyDocumentWriterProjection],
  ["authorization", verifyDocumentWriterProjectionAuthorization],
] as const;

for (const [entry, verify] of documentVerifiers) {
  test(`document ${entry} verification expires during its bundle write`, async () => {
    const fixture = await createMaterializedSyncFixture({
      documentId: `expiring-bundle-write-${entry}`,
    });
    const database = await expiringDuringBundleWrite(
      `expiring-bundle-write-document-${entry}`,
    );
    try {
      await expect(
        verify({
          execSql: database.execSql,
          projection: fixture.writerProjection,
          resolveUserKey: fixture.resolveProjectionUserKey,
          stillCurrent: database.stillCurrent,
        }),
      ).rejects.toBeInstanceOf(ProjectionVerificationCancelledError);
      expect(database.stillCurrent()).toBe(false);
    } finally {
      database.close();
    }
  });
}

test("a stalled bundle write delays container verification by at most its bound", async () => {
  const fixture = await containerFixture();
  const database = await createTestExecSql("stalled-bundle-write");
  const execSql = (async (...args: Parameters<ExecSql>) =>
    args[0].includes("verified_access_manifest_bundles")
      ? new Promise<never>(() => {})
      : database.execSql(...args)) as ExecSql;
  try {
    const verified = await Promise.race([
      verifyContainerWriterProjection({
        execSql,
        projection: fixture.projection,
        resolveUserKey: fixture.resolveUserKey,
      }).then(() => "verified"),
      new Promise((resolve) =>
        setTimeout(
          () => resolve("stalled"),
          BUNDLE_RETENTION_DEADLINE_MS + 1_000,
        ),
      ),
    ]);
    expect(verified).toBe("verified");
  } finally {
    database.close();
  }
});

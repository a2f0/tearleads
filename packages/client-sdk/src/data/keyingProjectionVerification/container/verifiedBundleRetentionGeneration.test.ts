import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import { createAuthor } from "../../../../test/helpers/documentFixturePrimitives";
import { createMaterializedSyncFixture } from "../../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { clearRemoteSyncState } from "../../../workflows/sync/remoteReset";
import { advanceKeyingCheckpointsAtomically } from "../../persistence/keyingCheckpoints/keyingCheckpointAdvancePersistence";
import { accessManifestCheckpoints } from "../../sqlite/schema";
import { verifiedAccessManifestBundles } from "../../sqlite/schema/verifiedManifestBundleSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import {
  verifyDocumentWriterProjection,
  verifyDocumentWriterProjectionAuthorization,
} from "../document/documentProjectionVerification";
import { ProjectionVerificationCancelledError } from "../types";
import { verifyContainerDestinationProjection } from "./containerDestinationVerification";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  verifyContainerWriterProjection,
} from "./containerProjectionVerification";

/** The verified-bundle write inside the checkpoint transaction. */
const BUNDLE_INSERT = /^insert into "verified_access_manifest_bundles"/;

/**
 * An executor whose generation expires while the verified bundles are being
 * written inside the checkpoint transaction: every check before passes.
 */
async function expiringDuringBundleWrite(name: string) {
  const database = await createTestExecSql(name);
  let expired = false;
  const execSql = (async (...args: Parameters<ExecSql>) => {
    if (BUNDLE_INSERT.test(args[0])) expired = true;
    return database.execSql(...args);
  }) as ExecSql;
  const { db } = getClientSQLitePersistenceRuntime(database.execSql);
  return {
    close: () => database.close(),
    execSql,
    stillCurrent: () => !expired,
    /** Rows the expired verification left behind: none, it rolled back. */
    committed: async () => [
      ...(await db.select().from(accessManifestCheckpoints)),
      ...(await db.select().from(verifiedAccessManifestBundles)),
    ],
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
      expect(await database.committed()).toEqual([]);
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
      expect(await database.committed()).toEqual([]);
    } finally {
      database.close();
    }
  });
}

test("a stalled bundle write holds only its own verification", async () => {
  const fixture = await containerFixture();
  const database = await createTestExecSql("stalled-bundle-write");
  let releaseWrite = () => {};
  const writeReleased = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  let stalled = false;
  let inFlight = 0;
  const execSql = (async (...args: Parameters<ExecSql>) => {
    inFlight += 1;
    try {
      if (BUNDLE_INSERT.test(args[0])) {
        stalled = true;
        await writeReleased;
      }
      return await database.execSql(...args);
    } finally {
      inFlight -= 1;
    }
  }) as ExecSql;
  try {
    let settled = false;
    const verification = verifyContainerWriterProjection({
      execSql,
      projection: fixture.projection,
      resolveUserKey: fixture.resolveUserKey,
    }).finally(() => {
      settled = true;
    });
    while (!stalled) await new Promise((resolve) => setTimeout(resolve, 1));
    // The write belongs to the verification's own checkpoint transaction.
    expect(settled).toBe(false);
    releaseWrite();
    const path = await verification;
    // Nothing the verification started outlives it ...
    expect(inFlight).toBe(0);
    // ... so a later checkpoint write and remote reset run at once.
    await advanceKeyingCheckpointsAtomically({
      access: path.map((head) => ({ head, predecessors: [] })),
      execSql,
      policies: [],
    });
    await clearRemoteSyncState(execSql, {
      organizationId: fixture.projection.organizationId,
    });
    const { db } = getClientSQLitePersistenceRuntime(database.execSql);
    expect(await db.select().from(verifiedAccessManifestBundles)).toEqual([]);
  } finally {
    database.close();
  }
});

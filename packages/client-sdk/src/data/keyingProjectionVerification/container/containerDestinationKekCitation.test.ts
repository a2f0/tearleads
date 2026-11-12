import { expect, test } from "bun:test";
import {
  computeContainerKekLevelDigest,
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import {
  type ContainerKekWireLevel,
  containerKekWireLevel,
} from "@tearleads/validators/response";
import { createAuthor } from "../../../../test/helpers/documentFixturePrimitives";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { advanceKeyingCheckpointsAtomically } from "../../persistence/keyingCheckpoints/keyingCheckpointAdvancePersistence";
import { loadVerifiedManifestCitations } from "../../persistence/verifiedManifestBundlePersistence";
import { containerTables } from "../../sqlite/schema";
import { containers } from "../../sqlite/schema/containerSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { verifyContainerDestinationProjection } from "./containerDestinationVerification";
import { verifyContainerWriterProjection } from "./containerProjectionVerification";

async function destinationFixture() {
  const { author, signingPublicKey } = await createAuthor();
  const encapsulationPublicKey = generateKemSeedAndKeyPair().publicKey;
  return {
    projection: await createContainerWriterProjectionFixture({
      containerId: "destination-parent",
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

async function storeParentRow(
  execSql: ExecSql,
  container: { id: string; organizationId: string },
) {
  await ensureSqlTables(execSql, containerTables);
  const now = new Date().toISOString();
  await getClientSQLitePersistenceRuntime(execSql)
    .db.insert(containers)
    .values({
      id: container.id,
      organizationId: container.organizationId,
      parentId: null,
      localCreatedAt: now,
      localUpdatedAt: now,
    })
    .run();
}

function citedLevels(citations: readonly object[]): ContainerKekWireLevel[] {
  return citations.filter(
    (citation): citation is ContainerKekWireLevel =>
      "containerKeyEpoch" in citation,
  );
}

test("levels a destination check served become citable; a forged held level is refused on refill", async () => {
  const fixture = await destinationFixture();
  const { projection } = fixture;
  const database = await createTestExecSql("destination-kek-citation");
  try {
    await verifyContainerDestinationProjection({
      execSql: database.execSql,
      projection,
      resolveUserKey: fixture.resolveUserKey,
    });
    await storeParentRow(database.execSql, {
      id: projection.containerId,
      organizationId: projection.organizationId,
    });
    const citeForChild = () =>
      loadVerifiedManifestCitations(database.execSql, {
        kind: "container",
        id: "unstored-child",
        listing: {
          organizationId: projection.organizationId,
          parentId: projection.containerId,
        },
      });

    const citeWithoutLineage = () =>
      loadVerifiedManifestCitations(database.execSql, {
        kind: "container",
        id: "new-root",
        listing: { organizationId: projection.organizationId, parentId: null },
      });

    // The destination path recorded the parent's level: a child read cites it.
    const served = projection.containerKeks.at(-1);
    if (!served) throw new Error("fixture has no container KEK level");
    const servedLevel = containerKekWireLevel(served);
    const held = citedLevels(await citeForChild());
    expect(held).toEqual([servedLevel]);
    expect(citedLevels(await citeWithoutLineage())).toEqual([servedLevel]);
    expect(await computeContainerKekLevelDigest(held[0] ?? servedLevel)).toBe(
      await computeContainerKekLevelDigest(servedLevel),
    );

    // A forged level stored self-consistently (its digest recomputed) is cited
    // like any held level ...
    const forged: ContainerKekWireLevel = {
      ...servedLevel,
      keyTargetHash: "f".repeat(64),
    };
    await advanceKeyingCheckpointsAtomically({
      access: [],
      execSql: database.execSql,
      policies: [],
      verifiedBundles: [
        { kekLevel: forged, organizationId: projection.organizationId },
      ],
    });
    expect(citedLevels(await citeForChild())).toEqual([forged]);
    expect(citedLevels(await citeWithoutLineage())).toEqual([forged]);

    // ... but a read that refills it verifies the bytes like served ones.
    const refilled = {
      ...projection,
      containerKeks: projection.containerKeks.map((kek) =>
        kek === served
          ? {
              ...forged,
              containerManifestHistory: kek.containerManifestHistory,
            }
          : kek,
      ),
    };
    await expect(
      verifyContainerWriterProjection({
        execSql: database.execSql,
        projection: refilled,
        resolveUserKey: fixture.resolveUserKey,
      }),
    ).rejects.toBeInstanceOf(KeyingVerificationError);
  } finally {
    database.close();
  }
});

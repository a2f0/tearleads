import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import {
  decodeContainerWriterProjection,
  encodeContainerWriterProjection,
  isRejectedDecodedProjection,
} from "@tearleads/validators/response";
import {
  isServedAccessManifestBundleWireResponse,
  toServedAccessManifestBundle,
} from "@tearleads/validators/util";
import { createAuthor } from "../../../../test/helpers/data/documentFixturePrimitives";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/data/trustedUserIdentity";
import { KeyingCheckpointRepository } from "../../persistence/keyingCheckpoints/keyingCheckpointRepository";
import { openPrincipalPolicyBundleReader } from "../../persistence/principalPolicy/principalPolicyBundleRepository";
import {
  dropHeldManifestBundles,
  loadVerifiedManifestCitations,
  suppressHeldCitations,
} from "../../persistence/verifiedManifestBundlePersistence";
import { ProjectionDependencyUnavailableError } from "../../shared/dependencyUnavailable";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  verifyContainerWriterProjection,
} from "../container/containerProjectionVerification";

const CONTAINER_ID = "seeded-container";
const target = { kind: "container", id: CONTAINER_ID } as const;

async function seededFixture() {
  const { author, signingPublicKey } = await createAuthor();
  const encapsulationPublicKey = generateKemSeedAndKeyPair().publicKey;
  const projection = await createContainerWriterProjectionFixture({
    containerId: CONTAINER_ID,
    encapsulationPublicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const [leaf] = projection.path;
  if (!leaf) throw new Error("fixture path missing");
  return {
    leaf,
    organizationId: author.organizationId,
    projection,
    resolveUserKey: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    }),
  };
}

function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

test("a wrong seeded bundle is refused once, dropped, and the next read verifies", async () => {
  const fixture = await seededFixture();
  const { leaf } = fixture;
  const database = await createTestExecSql("held-bundle-recovery");
  // An authored head stored at acknowledgement with a state the server
  // never served: citing it can only fail verification.
  const wrong = toServedAccessManifestBundle({
    ...leaf,
    state: { ...leaf.state, directGrants: [] },
  });
  const verify = (projection: typeof fixture.projection | null) => {
    if (!projection) throw new Error("projection did not decode");
    return verifyContainerWriterProjection({
      execSql: database.execSql,
      openPrincipalPolicyBundleReader,
      projection,
      resolveUserKey: fixture.resolveUserKey,
    });
  };
  try {
    await new KeyingCheckpointRepository(
      database.execSql,
    ).advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
      heads: [
        {
          checkpoint: {
            objectKind: "container",
            objectId: CONTAINER_ID,
            organizationId: fixture.organizationId,
            epoch: 1,
            manifestHash: leaf.manifestHash,
          },
          previousManifestHash: null,
          servedBundle: wrong,
        },
      ],
    });
    const held = new Map(
      (await loadVerifiedManifestCitations(database.execSql, target))
        .filter(isServedAccessManifestBundleWireResponse)
        .map((bundle) => [bundle.manifestHash, bundle]),
    );
    expect([...held.values()]).toEqual([wrong]);
    // The read cites the seeded row, so the server omits the leaf.
    const cited = decodeContainerWriterProjection(
      jsonRoundTrip(
        encodeContainerWriterProjection(
          fixture.projection,
          new Set([leaf.manifestHash]),
        ),
      ),
      held,
    );
    await expect(verify(cited)).rejects.toMatchObject({
      name: "KeyingVerificationError",
    });
    // No cache may serve the refused projection again.
    expect(isRejectedDecodedProjection(cited)).toBe(true);
    // Dropped, so the next read cites nothing and the server serves the leaf.
    expect(
      await loadVerifiedManifestCitations(database.execSql, target),
    ).toEqual([]);
    expect(
      await verify(
        decodeContainerWriterProjection(
          jsonRoundTrip(encodeContainerWriterProjection(fixture.projection)),
        ),
      ),
    ).toHaveLength(1);
    expect(
      await loadVerifiedManifestCitations(database.execSql, target),
    ).toContainEqual(toServedAccessManifestBundle(leaf));
  } finally {
    database.close();
  }
});

test("a projection that cited nothing fails as before", async () => {
  const fixture = await seededFixture();
  const { leaf } = fixture;
  const database = await createTestExecSql("held-bundle-uncited");
  try {
    await expect(
      verifyContainerWriterProjection({
        execSql: database.execSql,
        openPrincipalPolicyBundleReader,
        projection: {
          ...fixture.projection,
          path: [{ ...leaf, state: { ...leaf.state, directGrants: [] } }],
        },
        resolveUserKey: fixture.resolveUserKey,
      }),
    ).rejects.toMatchObject({ name: "KeyingVerificationError" });
  } finally {
    database.close();
  }
});

async function seedWrongRow(
  execSql: Parameters<typeof loadVerifiedManifestCitations>[0],
  fixture: Awaited<ReturnType<typeof seededFixture>>,
  wrong: ReturnType<typeof toServedAccessManifestBundle>,
) {
  await new KeyingCheckpointRepository(
    execSql,
  ).advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
    heads: [
      {
        checkpoint: {
          objectKind: "container",
          objectId: CONTAINER_ID,
          organizationId: fixture.organizationId,
          epoch: 1,
          manifestHash: fixture.leaf.manifestHash,
        },
        previousManifestHash: null,
        servedBundle: wrong,
      },
    ],
  });
  const held = new Map(
    (await loadVerifiedManifestCitations(execSql, target))
      .filter(isServedAccessManifestBundleWireResponse)
      .map((bundle) => [bundle.manifestHash, bundle]),
  );
  const cited = decodeContainerWriterProjection(
    jsonRoundTrip(
      encodeContainerWriterProjection(
        fixture.projection,
        new Set([fixture.leaf.manifestHash]),
      ),
    ),
    held,
  );
  if (!cited) throw new Error("cited projection did not decode");
  return cited;
}

test("a held bundle naming a principal head that does not exist is dropped too", async () => {
  const fixture = await seededFixture();
  const { leaf } = fixture;
  const database = await createTestExecSql("held-bundle-missing-head");
  // Its manifest cites a group head no policy evidence names: refused as a
  // missing dependency before its hash is checked.
  const wrong = toServedAccessManifestBundle({
    ...leaf,
    manifest: {
      ...leaf.manifest,
      referencedPrincipalHeads: [
        {
          keyEpoch: 1,
          keyFingerprint: "f".repeat(64),
          principalId: "absent-group",
          principalType: "group",
          stateHash: "a".repeat(64),
          version: 1,
        },
      ],
    },
  });
  try {
    const cited = await seedWrongRow(database.execSql, fixture, wrong);
    await expect(
      verifyContainerWriterProjectionWithoutRecovery(database.execSql, cited),
    ).rejects.toMatchObject({ code: "missing_dependency" });
    await expect(
      collectContainerWriterProjectionPrincipalPolicies({
        execSql: database.execSql,
        openPrincipalPolicyBundleReader,
        projection: cited,
        resolveUserKey: fixture.resolveUserKey,
      }),
    ).rejects.toMatchObject({ name: "KeyingVerificationError" });
    expect(
      await loadVerifiedManifestCitations(database.execSql, target),
    ).toEqual([]);
  } finally {
    database.close();
  }
});

test("a refused cited read keeps a newer row and drops nothing once stale", async () => {
  const fixture = await seededFixture();
  const { leaf } = fixture;
  const database = await createTestExecSql("held-bundle-newer-row");
  const wrong = toServedAccessManifestBundle({
    ...leaf,
    state: { ...leaf.state, directGrants: [] },
  });
  try {
    const cited = await seedWrongRow(database.execSql, fixture, wrong);
    // A request no longer current drops nothing.
    await dropHeldManifestBundles(database.execSql, [wrong], () => false);
    expect(
      await loadVerifiedManifestCitations(database.execSql, target),
    ).toEqual([wrong]);
    // A newer read verifies and stores the served bytes over the wrong row
    // while the older cited read is still being refused.
    expect(
      await verifyContainerWriterProjection({
        execSql: database.execSql,
        openPrincipalPolicyBundleReader,
        projection: fixture.projection,
        resolveUserKey: fixture.resolveUserKey,
      }),
    ).toHaveLength(1);
    await expect(
      verifyContainerWriterProjection({
        execSql: database.execSql,
        openPrincipalPolicyBundleReader,
        projection: cited,
        resolveUserKey: fixture.resolveUserKey,
      }),
    ).rejects.toMatchObject({ name: "KeyingVerificationError" });
    expect(
      await loadVerifiedManifestCitations(database.execSql, target),
    ).toContainEqual(toServedAccessManifestBundle(leaf));
  } finally {
    database.close();
  }
});

/** The same verification with no store to recover: shows the raw refusal. */
function verifyContainerWriterProjectionWithoutRecovery(
  execSql: Parameters<typeof loadVerifiedManifestCitations>[0],
  projection: Awaited<ReturnType<typeof seedWrongRow>>,
) {
  return verifyContainerWriterProjection({
    execSql,
    openPrincipalPolicyBundleReader,
    projection: { ...projection },
    resolveUserKey: async () => null,
  });
}

test("a held bundle whose signer cannot be resolved is dropped too", async () => {
  const fixture = await seededFixture();
  const { leaf } = fixture;
  const database = await createTestExecSql("held-bundle-unknown-signer");
  // Unavailable before its signature is checked: no key for this signer.
  const wrong = toServedAccessManifestBundle({
    ...leaf,
    event: {
      ...leaf.event,
      event: { ...leaf.event.event, signerUserId: "unknown-signer" },
    },
  });
  try {
    const cited = await seedWrongRow(database.execSql, fixture, wrong);
    await expect(
      verifyContainerWriterProjection({
        execSql: database.execSql,
        openPrincipalPolicyBundleReader,
        projection: cited,
        resolveUserKey: fixture.resolveUserKey,
      }),
    ).rejects.toBeInstanceOf(ProjectionDependencyUnavailableError);
    expect(
      await loadVerifiedManifestCitations(database.execSql, target),
    ).toEqual([]);
  } finally {
    database.close();
  }
});

test("held bundles being dropped are not cited meanwhile", async () => {
  const fixture = await seededFixture();
  const database = await createTestExecSql("held-bundle-suppressed");
  const wrong = toServedAccessManifestBundle({
    ...fixture.leaf,
    state: { ...fixture.leaf.state, directGrants: [] },
  });
  try {
    await seedWrongRow(database.execSql, fixture, wrong);
    const release = suppressHeldCitations([fixture.leaf.manifestHash]);
    expect(
      await loadVerifiedManifestCitations(database.execSql, target),
    ).toEqual([]);
    release();
    expect(
      await loadVerifiedManifestCitations(database.execSql, target),
    ).toEqual([wrong]);
  } finally {
    database.close();
  }
});

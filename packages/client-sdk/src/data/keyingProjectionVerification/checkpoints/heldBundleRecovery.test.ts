import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  decodeContainerWriterProjection,
  encodeContainerWriterProjection,
  isRejectedDecodedProjection,
  rejectDecodedProjection,
} from "@tearleads/validators/response";
import {
  isServedAccessManifestBundleWireResponse,
  toServedAccessManifestBundle,
} from "@tearleads/validators/util";
import {
  CONTAINER_ID,
  jsonRoundTrip,
  seededFixture,
  seedWrongRow,
  target,
} from "../../../../test/helpers/data/heldBundleFixtures";
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
import { checkWithHeldBundleRecovery } from "./heldBundleRecovery";

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
    // The drop reports it did not commit, so recovery keeps the bundles out
    // of citations instead of releasing them.
    expect(
      await dropHeldManifestBundles(database.execSql, [wrong], () => false),
    ).toBe(false);
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

test("a request superseded during its signer lookup changes no shared state", async () => {
  const fixture = await seededFixture();
  const database = await createTestExecSql("held-bundle-superseded");
  const wrong = toServedAccessManifestBundle({
    ...fixture.leaf,
    state: { ...fixture.leaf.state, directGrants: [] },
  });
  let current = true;
  try {
    const cited = await seedWrongRow(database.execSql, fixture, wrong);
    await expect(
      verifyContainerWriterProjection({
        execSql: database.execSql,
        openPrincipalPolicyBundleReader,
        projection: cited,
        resolveUserKey: async (userId) => {
          current = false;
          return fixture.resolveUserKey(userId);
        },
        stillCurrent: () => current,
      }),
    ).rejects.toThrow();
    expect(isRejectedDecodedProjection(cited)).toBe(false);
    expect(
      await loadVerifiedManifestCitations(database.execSql, target),
    ).toEqual([wrong]);
  } finally {
    database.close();
  }
});

test("a consistency check that refuses a cited projection drops its held bundles", async () => {
  const fixture = await seededFixture();
  const database = await createTestExecSql("held-bundle-precheck");
  const wrong = toServedAccessManifestBundle({
    ...fixture.leaf,
    state: { ...fixture.leaf.state, directGrants: [] },
  });
  try {
    const cited = await seedWrongRow(database.execSql, fixture, wrong);
    // A precheck before verification, as a queued write runs on its head.
    await expect(
      checkWithHeldBundleRecovery(
        { execSql: database.execSql, projection: cited },
        async () => {
          throw new Error("Document sync manifest state mismatch");
        },
      ),
    ).rejects.toThrow("state mismatch");
    expect(isRejectedDecodedProjection(cited)).toBe(true);
    expect(
      await loadVerifiedManifestCitations(database.execSql, target),
    ).toEqual([]);
  } finally {
    database.close();
  }
});

test("a citation load overlapping an eviction does not return the evicted row", async () => {
  const fixture = await seededFixture();
  const database = await createTestExecSql("held-bundle-overlap");
  const wrong = toServedAccessManifestBundle({
    ...fixture.leaf,
    state: { ...fixture.leaf.state, directGrants: [] },
  });
  try {
    await seedWrongRow(database.execSql, fixture, wrong);
    let evicted = false;
    // The eviction starts and finishes while the load is reading.
    const execSql = new Proxy(database.execSql, {
      apply(target, thisArg, args: unknown[]) {
        if (!evicted) {
          evicted = true;
          suppressHeldCitations([fixture.leaf.manifestHash])();
        }
        return Reflect.apply(target, thisArg, args);
      },
    });
    expect(await loadVerifiedManifestCitations(execSql, target)).toEqual([]);
    expect(evicted).toBe(true);
  } finally {
    database.close();
  }
});

test("a citation load that starts during an eviction does not return the evicted row", async () => {
  const fixture = await seededFixture();
  const database = await createTestExecSql("held-bundle-overlap-start");
  const wrong = toServedAccessManifestBundle({
    ...fixture.leaf,
    state: { ...fixture.leaf.state, directGrants: [] },
  });
  try {
    await seedWrongRow(database.execSql, fixture, wrong);
    // The eviction is under way when the load starts and ends during it.
    const release = suppressHeldCitations([fixture.leaf.manifestHash]);
    let released = false;
    const execSql = new Proxy(database.execSql, {
      apply(target, thisArg, args: unknown[]) {
        if (!released) {
          released = true;
          release();
        }
        return Reflect.apply(target, thisArg, args);
      },
    });
    expect(await loadVerifiedManifestCitations(execSql, target)).toEqual([]);
    expect(released).toBe(true);
  } finally {
    database.close();
  }
});

test("a passing consistency check does not clear another read's refusal", async () => {
  const fixture = await seededFixture();
  const database = await createTestExecSql("held-bundle-check-accepts-nothing");
  const wrong = toServedAccessManifestBundle({
    ...fixture.leaf,
    state: { ...fixture.leaf.state, directGrants: [] },
  });
  try {
    const refused = await seedWrongRow(database.execSql, fixture, wrong);
    const checked = await seedWrongRow(database.execSql, fixture, wrong);
    rejectDecodedProjection(refused);
    expect(isRejectedDecodedProjection(checked)).toBe(true);
    await checkWithHeldBundleRecovery(
      { execSql: database.execSql, projection: checked },
      async () => undefined,
    );
    expect(isRejectedDecodedProjection(checked)).toBe(true);
  } finally {
    database.close();
  }
});

test("held bundles a failed drop could not remove stay out of citations", async () => {
  const fixture = await seededFixture();
  const database = await createTestExecSql("held-bundle-failed-drop");
  const wrong = toServedAccessManifestBundle({
    ...fixture.leaf,
    state: { ...fixture.leaf.state, directGrants: [] },
  });
  try {
    const cited = await seedWrongRow(database.execSql, fixture, wrong);
    // The store refuses the delete.
    const execSql = new Proxy(database.execSql, {
      apply(target, thisArg, args: unknown[]) {
        if (/^\s*delete\b/iu.test(String(args[0])))
          throw new Error("disk I/O error");
        return Reflect.apply(target, thisArg, args);
      },
    });
    await expect(
      verifyContainerWriterProjection({
        execSql,
        openPrincipalPolicyBundleReader,
        projection: cited,
        resolveUserKey: fixture.resolveUserKey,
      }),
    ).rejects.toMatchObject({ name: "KeyingVerificationError" });
    // The row survived, but this process no longer cites it.
    expect(
      await loadVerifiedManifestCitations(database.execSql, target),
    ).toEqual([]);
  } finally {
    database.close();
  }
});

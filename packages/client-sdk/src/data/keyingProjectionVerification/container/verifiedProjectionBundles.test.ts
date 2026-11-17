import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import { containerKekWireLevel } from "@tearleads/validators/response";
import { toServedAccessManifestBundle } from "@tearleads/validators/util";
import { createAuthor } from "../../../../test/helpers/data/documentFixturePrimitives";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/data/trustedUserIdentity";
import { openPrincipalPolicyBundleReader } from "../../persistence/principalPolicy/principalPolicyBundleRepository";
import { loadVerifiedManifestCitations } from "../../persistence/verifiedManifestBundlePersistence";
import { verifyContainerWriterProjection } from "./containerProjectionVerification";

async function createVerificationFixture() {
  const { author, signingPublicKey } = await createAuthor();
  const encapsulationPublicKey = generateKemSeedAndKeyPair().publicKey;
  const projection = await createContainerWriterProjectionFixture({
    containerId: "retained-container",
    encapsulationPublicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  return {
    projection,
    resolveUserKey: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    }),
  };
}

const target = { kind: "container", id: "retained-container" } as const;

test("a verified projection's bundles and KEK levels become citable", async () => {
  const fixture = await createVerificationFixture();
  const database = await createTestExecSql("verified-bundles-retained");
  try {
    await verifyContainerWriterProjection({
      execSql: database.execSql,
      openPrincipalPolicyBundleReader,
      projection: fixture.projection,
      resolveUserKey: fixture.resolveUserKey,
    });
    // Each verified level first, in its wire form, then the bundles as
    // served: the decoded state is rebuilt from them, never stored.
    expect(
      await loadVerifiedManifestCitations(database.execSql, target),
    ).toEqual([
      ...fixture.projection.containerKeks.map(containerKekWireLevel),
      ...fixture.projection.path.map(toServedAccessManifestBundle),
    ]);
  } finally {
    database.close();
  }
});

test("a refused projection leaves nothing to cite", async () => {
  const fixture = await createVerificationFixture();
  const database = await createTestExecSql("verified-bundles-refused");
  const [leaf] = fixture.projection.path;
  if (!leaf) throw new Error("fixture path missing");
  try {
    await expect(
      verifyContainerWriterProjection({
        execSql: database.execSql,
        openPrincipalPolicyBundleReader,
        projection: {
          ...fixture.projection,
          path: [{ ...leaf, state: { ...leaf.state, epoch: 99 } }],
        },
        resolveUserKey: fixture.resolveUserKey,
      }),
    ).rejects.toThrow();
    expect(
      await loadVerifiedManifestCitations(database.execSql, target),
    ).toEqual([]);
  } finally {
    database.close();
  }
});

test("a cached hash never stores a later projection's different bytes", async () => {
  const fixture = await createVerificationFixture();
  const first = await createTestExecSql("verified-bundles-cache-first");
  const second = await createTestExecSql("verified-bundles-cache-second");
  const [leaf] = fixture.projection.path;
  if (!leaf) throw new Error("fixture path missing");
  const verifiedByHash = new Map();
  try {
    await verifyContainerWriterProjection({
      execSql: first.execSql,
      openPrincipalPolicyBundleReader,
      projection: fixture.projection,
      resolveUserKey: fixture.resolveUserKey,
      verifiedByHash,
    });
    // Same manifest hash, different signed bytes: the shared cache
    // recognizes the hash, but these bytes were never verified, so they are
    // verified afresh and refused.
    const tampered = {
      ...leaf,
      event: {
        ...leaf.event,
        event: { ...leaf.event.event, signature: "AAAA" },
      },
    };
    await expect(
      verifyContainerWriterProjection({
        execSql: second.execSql,
        openPrincipalPolicyBundleReader,
        projection: { ...fixture.projection, path: [tampered] },
        resolveUserKey: fixture.resolveUserKey,
        verifiedByHash,
      }),
    ).rejects.toMatchObject({ code: "signature_mismatch" });
    expect(
      await loadVerifiedManifestCitations(second.execSql, target),
    ).not.toContainEqual(toServedAccessManifestBundle(tampered));
  } finally {
    first.close();
    second.close();
  }
});

test("a cache hit still refuses a copy whose state differs", async () => {
  const fixture = await createVerificationFixture();
  const first = await createTestExecSql("verified-bundles-warm-first");
  const second = await createTestExecSql("verified-bundles-warm-second");
  const [leaf] = fixture.projection.path;
  if (!leaf) throw new Error("fixture path missing");
  const verifiedByHash = new Map();
  try {
    await verifyContainerWriterProjection({
      execSql: first.execSql,
      openPrincipalPolicyBundleReader,
      projection: fixture.projection,
      resolveUserKey: fixture.resolveUserKey,
      verifiedByHash,
    });
    // Same hash and served bytes, warm cache, but a state field the served
    // form leaves off (it is completed from the signed manifest) differs.
    const repinned = { ...leaf, state: { ...leaf.state, epoch: 99 } };
    await expect(
      verifyContainerWriterProjection({
        execSql: second.execSql,
        openPrincipalPolicyBundleReader,
        projection: { ...fixture.projection, path: [repinned] },
        resolveUserKey: fixture.resolveUserKey,
        verifiedByHash,
      }),
    ).rejects.toMatchObject({ code: "hash_mismatch" });
  } finally {
    first.close();
    second.close();
  }
});

test("a valid copy with different bytes verifies afresh from a warm cache", async () => {
  const fixture = await createVerificationFixture();
  const databases = await Promise.all(
    ["primed", "variant", "repeat"].map((name) =>
      createTestExecSql(`verified-bundles-${name}`),
    ),
  );
  const [primed, variant, repeat] = databases;
  const [leaf] = fixture.projection.path;
  if (!leaf || !primed || !variant || !repeat) throw new Error("fixture");
  // A field the event reader does not keep: a cold verification accepts it,
  // so a cache primed with the original bytes must too, and must keep it.
  const noted = {
    ...leaf,
    event: { ...leaf.event, event: { ...leaf.event.event, note: "kept" } },
  };
  const verifiedByHash = new Map();
  const verify = (
    database: { readonly execSql: typeof primed.execSql },
    path: readonly (typeof leaf)[],
  ) =>
    verifyContainerWriterProjection({
      execSql: database.execSql,
      openPrincipalPolicyBundleReader,
      projection: { ...fixture.projection, path: [...path] },
      resolveUserKey: fixture.resolveUserKey,
      verifiedByHash,
    });
  try {
    expect(await verify(primed, [leaf])).toHaveLength(1);
    expect(await verify(variant, [noted])).toHaveLength(1);
    expect(
      await loadVerifiedManifestCitations(variant.execSql, target),
    ).toContainEqual(toServedAccessManifestBundle(noted));
    // The same bytes again are a cache hit.
    expect(await verify(repeat, [noted])).toHaveLength(1);
  } finally {
    for (const database of databases) database.close();
  }
});

test("a bundle changed while its signer resolves is neither verified nor stored", async () => {
  const fixture = await createVerificationFixture();
  const database = await createTestExecSql("verified-bundles-snapshot");
  const [leaf] = fixture.projection.path;
  if (!leaf) throw new Error("fixture path missing");
  const live = structuredClone(leaf);
  const original = toServedAccessManifestBundle(leaf);
  try {
    await verifyContainerWriterProjection({
      execSql: database.execSql,
      openPrincipalPolicyBundleReader,
      projection: { ...fixture.projection, path: [live] },
      // The served object changes while verification awaits its signer.
      resolveUserKey: async (userId) => {
        Reflect.set(live.event.event, "signature", "AAAA");
        return fixture.resolveUserKey(userId);
      },
    });
    const stored = await loadVerifiedManifestCitations(
      database.execSql,
      target,
    );
    expect(stored).not.toContainEqual(toServedAccessManifestBundle(live));
    expect(stored).not.toContainEqual(original);
  } finally {
    database.close();
  }
});

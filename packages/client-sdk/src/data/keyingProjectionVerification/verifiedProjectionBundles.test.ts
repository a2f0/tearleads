import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import { createAuthor } from "../../../test/helpers/documentFixturePrimitives";
import { createTestTrustedUserIdentityResolver } from "../../../test/helpers/trustedUserIdentity";
import { loadVerifiedManifestCitations } from "../persistence/verifiedManifestBundlePersistence";
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

test("a verified projection's bundles become citable", async () => {
  const fixture = await createVerificationFixture();
  const database = await createTestExecSql("verified-bundles-retained");
  try {
    await verifyContainerWriterProjection({
      execSql: database.execSql,
      projection: fixture.projection,
      resolveUserKey: fixture.resolveUserKey,
    });
    expect(
      await loadVerifiedManifestCitations(database.execSql, target),
    ).toEqual(fixture.projection.path);
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

import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import {
  decodeContainerWriterProjection,
  encodeContainerWriterProjection,
} from "@tearleads/validators/response";
import {
  isServedAccessManifestBundleWireResponse,
  toServedAccessManifestBundle,
} from "@tearleads/validators/util";
import { createAuthor } from "../../../../test/helpers/data/documentFixturePrimitives";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/data/trustedUserIdentity";
import { KeyingCheckpointRepository } from "../../persistence/keyingCheckpoints/keyingCheckpointRepository";
import { openPrincipalPolicyBundleReader } from "../../persistence/principalPolicy/principalPolicyBundleRepository";
import { loadVerifiedManifestCitations } from "../../persistence/verifiedManifestBundlePersistence";
import { ProjectionDependencyUnavailableError } from "../../shared/dependencyUnavailable";
import { verifyContainerWriterProjection } from "../container/containerProjectionVerification";

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

test("a wrong seeded bundle is dropped and the next read verifies", async () => {
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
    await expect(verify(cited)).rejects.toBeInstanceOf(
      ProjectionDependencyUnavailableError,
    );
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

import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import {
  decodeContainerWriterProjection,
  encodeContainerWriterProjection,
} from "@tearleads/validators/response";
import {
  isServedAccessManifestBundleWireResponse,
  type toServedAccessManifestBundle,
} from "@tearleads/validators/util";
import { KeyingCheckpointRepository } from "../../../src/data/persistence/keyingCheckpoints/keyingCheckpointRepository";
import { loadVerifiedManifestCitations } from "../../../src/data/persistence/verifiedManifestBundlePersistence";
import { createAuthor } from "./documentFixturePrimitives";
import { createTestTrustedUserIdentityResolver } from "./trustedUserIdentity";

/** A container whose leaf head this device authored and seeded. */
export const CONTAINER_ID = "seeded-container";
export const target = { kind: "container", id: CONTAINER_ID } as const;

export async function seededFixture() {
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

export function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export async function seedWrongRow(
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

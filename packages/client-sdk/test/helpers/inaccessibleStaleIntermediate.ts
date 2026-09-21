import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../../src/workflows/containers/child/create";
import { buildMaterializedContainerRekeyPlan } from "../../src/workflows/containers/child/rekey";
import { buildMaterializedContainerSharePlan } from "../../src/workflows/containers/child/shareMaterialization";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "./containerFixtures";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

/**
 * root -> intermediate -> leaf, with only `leaf` shared (write) to a peer and
 * the root rotated afterwards. `intermediate` still pins the retired root
 * epoch, so the whole path is stale for new writes; the peer holds the leaf
 * KEK but neither ancestor's, so it can neither rekey `intermediate` nor be
 * handed its secret.
 */
export async function createInaccessibleStaleIntermediateFixture() {
  const root = await createParentProjection();
  const peer = await createAuthor({
    organizationId: root.author.organizationId,
    userId: "leaf-writer",
  });
  const peerKem = generateKemSeedAndKeyPair();
  const ownerResolver = createParentProjectionUserKeyResolver(root);
  const peerIdentity = await createTestTrustedUserIdentity({
    userId: peer.author.signerUserId,
    signingKeyFingerprint: peer.author.signerKeyFingerprint,
    signingPublicKey: peer.signingPublicKey,
    encapsulationPublicKey: peerKem.publicKey,
  });
  const resolveProjectionUserKey = async (userId: string) =>
    userId === peerIdentity.userId ? peerIdentity : ownerResolver(userId);
  const database = await createTestExecSql("inaccessible-intermediate-owner");
  const ownerInput = {
    author: root.author,
    execSql: database.execSql,
    persistVerificationCheckpoints: false,
    resolveProjectionUserKey,
    targetSecretKey: root.secretKey,
  };
  const createChild = async (
    parentProjection: ContainerWriterProjectionResponse,
    containerId: string,
  ) => {
    const materializedPlan = await buildMaterializedContainerCreatePlan({
      ...ownerInput,
      containerId,
      parentProjection,
      parentSecretKey: root.secretKey,
    });
    return {
      epochId: materializedPlan.plan.containerKeyEpochId,
      key: materializedPlan.containerKey,
      projection: childContainerWriterProjectionFromCreatePlan({
        materializedPlan,
        parentProjection,
      }),
    };
  };
  try {
    const intermediate = await createChild(root.projection, "intermediate");
    const leaf = await createChild(intermediate.projection, "leaf");
    const shared = await buildMaterializedContainerSharePlan({
      ...ownerInput,
      accessLevel: "write",
      previousProjection: leaf.projection,
      recipient: {
        subjectType: "user",
        subjectId: peer.author.signerUserId,
        recipientEncapsulationPublicKey: peerKem.publicKey,
      },
    });
    const sharedResponse = await createMutationResponseFromRequest(
      shared.plan.request,
      leaf.projection.containerKeks.at(-1),
    );
    const sharedLeafKek = {
      ...sharedResponse.containerKek,
      containerManifestHistory: [
        ...sharedResponse.containerKek.containerManifestHistory,
        ...leaf.projection.path.slice(-1),
      ],
    };
    /** The leaf as served before the rotation: every pin current. */
    const currentLeaf: ContainerWriterProjectionResponse = {
      ...leaf.projection,
      path: [
        ...leaf.projection.path.slice(0, -1),
        sharedResponse.accessManifest,
      ],
      containerKeks: [
        ...leaf.projection.containerKeks.slice(0, -1),
        sharedLeafKek,
      ],
    };
    const rotatedRoot = await buildMaterializedContainerRekeyPlan({
      ...ownerInput,
      previousProjection: root.projection,
    });
    /** The leaf as served after the rotation: `intermediate` pins a retired root. */
    const staleLeaf: ContainerWriterProjectionResponse = {
      ...currentLeaf,
      path: [
        ...rotatedRoot.writerProjection.path,
        ...currentLeaf.path.slice(1),
      ],
      containerKeks: [
        ...rotatedRoot.writerProjection.containerKeks,
        ...currentLeaf.containerKeks.slice(1),
      ],
    };
    return {
      currentLeaf,
      intermediate,
      leaf,
      ownerInput,
      peer,
      peerSecretKey: peerKem.secretKey,
      resolveProjectionUserKey,
      root,
      rotatedRoot,
      staleLeaf,
    };
  } finally {
    database.close();
  }
}

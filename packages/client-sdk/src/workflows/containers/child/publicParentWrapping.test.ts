import { expect, test } from "bun:test";
import {
  deriveContainerKekWrappingPublicKey,
  generateKemSeedAndKeyPair,
  unwrapContainerKekParentWrap,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { assertSignedWrappingPublicKey } from "../../../data/documents/shared/containerKekWrapping";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "./create";
import { buildMaterializedContainerRekeyPlan } from "./rekey";
import { buildMaterializedContainerSharePlan } from "./shareMaterialization";

test("a child-only writer repairs its parent wrap without receiving either parent secret", async () => {
  const root = await createParentProjection();
  const peer = await createAuthor({
    organizationId: root.author.organizationId,
    userId: "child-writer",
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
  const database = await createTestExecSql("public-parent-wrap-author");
  const coldPeer = await createTestExecSql("public-parent-wrap-cold-peer");
  try {
    const ownerInput = {
      author: root.author,
      execSql: database.execSql,
      resolveProjectionUserKey,
      targetSecretKey: root.secretKey,
    };
    const child = await buildMaterializedContainerCreatePlan({
      ...ownerInput,
      parentProjection: root.projection,
      parentSecretKey: root.secretKey,
      containerId: "shared-child",
    });
    const childProjection = childContainerWriterProjectionFromCreatePlan({
      materializedPlan: child,
      parentProjection: root.projection,
    });
    const shared = await buildMaterializedContainerSharePlan({
      ...ownerInput,
      accessLevel: "write",
      previousProjection: childProjection,
      recipient: {
        subjectType: "user",
        subjectId: peer.author.signerUserId,
        recipientEncapsulationPublicKey: peerKem.publicKey,
      },
    });
    const sharedResponse = await createMutationResponseFromRequest(
      shared.plan.request,
      childProjection.containerKeks.at(-1),
    );
    const rotatedRoot = await buildMaterializedContainerRekeyPlan({
      ...ownerInput,
      previousProjection: root.projection,
    });
    const staleChild = {
      ...childProjection,
      path: [
        ...rotatedRoot.writerProjection.path,
        sharedResponse.accessManifest,
      ],
      containerKeks: [
        ...rotatedRoot.writerProjection.containerKeks,
        {
          ...sharedResponse.containerKek,
          containerManifestHistory: [
            ...sharedResponse.containerKek.containerManifestHistory,
            ...childProjection.path.slice(-1),
          ],
        },
      ],
    };
    const peerInput = {
      author: peer.author,
      execSql: coldPeer.execSql,
      resolveProjectionUserKey,
      targetSecretKey: peerKem.secretKey,
    };
    const peerKeys = await unwrapContainerKekPath({
      ...peerInput,
      projection: staleChild,
      secretKey: peerKem.secretKey,
    });
    expect(peerKeys.get(child.plan.containerKeyEpochId)).toEqual(
      child.containerKey,
    );
    expect(peerKeys.has(root.parentKekState.containerKeyEpochId)).toBe(false);
    expect(peerKeys.has(rotatedRoot.plan.containerKeyEpochId)).toBe(false);
    const repaired = await buildMaterializedContainerRekeyPlan({
      ...peerInput,
      previousProjection: staleChild,
    });
    const ownerKeys = await unwrapContainerKekPath({
      ...ownerInput,
      projection: repaired.writerProjection,
      secretKey: root.secretKey,
    });
    expect(ownerKeys.get(repaired.plan.containerKeyEpochId)).toEqual(
      repaired.containerKey,
    );
    expect(ownerKeys.get(child.plan.containerKeyEpochId)).toEqual(
      child.containerKey,
    );
    const parentWrap = repaired.plan.wraps.find(
      (wrap) => wrap.recipientKind === "container",
    );
    if (!parentWrap) throw new Error("Expected a parent recipient");
    expect(parentWrap.recipientKeyEpochId).toBe(
      rotatedRoot.plan.containerKeyEpochId,
    );
    // A holder of the retired root secret cannot open the new child epoch.
    await expect(
      unwrapContainerKekParentWrap({
        ...parentWrap,
        parentContainerId: root.projection.containerId,
        parentKeyMaterial: root.parentContainerKek,
      }),
    ).rejects.toThrow();
  } finally {
    database.close();
    coldPeer.close();
  }
});

test("the signed wrapping public key is bound to the real KEK material", async () => {
  const root = await createParentProjection();
  const database = await createTestExecSql("public-parent-wrap-binding");
  try {
    // A projection edit is already caught by the manifest state hash, so this
    // binding is what remains: a genuinely signed manifest whose published
    // wrapping key does not derive from the KEK material actually presented.
    await expect(
      unwrapContainerKekPath({
        execSql: database.execSql,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(root),
        projection: {
          ...root.projection,
          path: [
            {
              ...root.projection.path[0],
              state: {
                ...root.projection.path[0]?.state,
                containerKeyPublicKey:
                  await deriveContainerKekWrappingPublicKey({
                    containerId: root.projection.containerId,
                    keyMaterial: crypto.getRandomValues(new Uint8Array(32)),
                  }),
              },
            },
            ...root.projection.path.slice(1),
          ],
        } as typeof root.projection,
        secretKey: root.secretKey,
      }),
    ).rejects.toThrow();

    await expect(
      assertSignedWrappingPublicKey(
        root.projection,
        0,
        crypto.getRandomValues(new Uint8Array(32)),
      ),
    ).rejects.toThrow(/wrapping public key does not match KEK material/);

    // The real material satisfies it.
    await assertSignedWrappingPublicKey(
      root.projection,
      0,
      root.parentContainerKek,
    );
  } finally {
    database.close();
  }
});

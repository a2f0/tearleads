import { expect, test } from "bun:test";
import {
  computeContainerKekMaterialId,
  computeContainerKeyEpochHash,
  createContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import type { PredecessorContainerKekResponse } from "@tearleads/validators/response";
import {
  createProjection,
  createUserContainerWrap,
  createWrappedProjection,
  fixtureHash,
  getOnlyTarget,
} from "../../../../test/helpers/documentFixtures";
import { readContainerKeyEpoch } from "../../keyingProjectionVerification/readers";
import { unwrapContainerKekPath } from "./projection";

test("deriveDocumentCreateTargets uses the leaf projection manifest and KEK", async () => {
  const projection = await createProjection();
  const currentManifest = projection.path[0];
  const currentKek = projection.containerKeks[0];
  if (!currentManifest || !currentKek) {
    throw new Error("Expected test projection to include current state");
  }
  const staleManifestHash = await fixtureHash("stale-container-manifest");
  const staleKek = {
    ...currentKek,
    accessManifestHash: staleManifestHash,
    containerKeyEpochId: "container-key-epoch-stale",
    keyEpochHash: await fixtureHash("stale-container-key-epoch"),
    keyTargetHash: await fixtureHash("stale-container-key-target"),
  };
  const target = getOnlyTarget({
    ...projection,
    path: [
      { ...currentManifest, manifestHash: staleManifestHash },
      ...projection.path,
    ],
    containerKeks: [staleKek, ...projection.containerKeks],
  });

  expect(target).toEqual({
    containerId: projection.containerId,
    containerManifestHash: currentManifest.manifestHash,
    containerKeyEpochId: currentKek.containerKeyEpochId,
    containerKeyEpoch: currentKek.containerKeyEpoch,
  });
});

test("unwrapContainerKekPath follows parent KEK edges to the leaf", async () => {
  const {
    childContainerKek,
    childContainerKeyEpochId,
    projection,
    rootContainerKek,
    rootContainerKeyEpochId,
    secretKey,
  } = await createWrappedProjection();
  await expect(
    unwrapContainerKekPath({ projection, secretKey } as Parameters<
      typeof unwrapContainerKekPath
    >[0]),
  ).rejects.toThrow("requires projection key verification");

  const unwrapped = await unwrapContainerKekPath({
    projection,
    secretKey,
    trustedLocalProjection: true,
  });
  expect(Array.from(unwrapped.get(rootContainerKeyEpochId) ?? [])).toEqual(
    Array.from(rootContainerKek),
  );
  expect(Array.from(unwrapped.get(childContainerKeyEpochId) ?? [])).toEqual(
    Array.from(childContainerKek),
  );
});

async function rotateRootKekFixture() {
  const fixture = await createWrappedProjection();
  const rootKek = fixture.projection.containerKeks[0];
  const childKek = fixture.projection.containerKeks[1];
  if (!rootKek || !childKek) {
    throw new Error("Expected root and child container KEK fixtures");
  }

  const successorKey = crypto.getRandomValues(new Uint8Array(32));
  const successorEpoch = rootKek.containerKeyEpoch + 1;
  const successorEpochId = await computeContainerKekMaterialId({
    containerId: rootKek.containerId,
    keyEpoch: successorEpoch,
    keyMaterial: successorKey,
  });
  const successorKeyEpoch = {
    ...readContainerKeyEpoch(rootKek.keyEpoch, "root key epoch"),
    id: successorEpochId,
    keyEpoch: successorEpoch,
  };
  const bridge = await createContainerKekPredecessorBridge({
    containerId: rootKek.containerId,
    predecessorContainerKey: fixture.rootContainerKek,
    predecessorContainerKeyEpochId: rootKek.containerKeyEpochId,
    successorContainerKey: successorKey,
    successorContainerKeyEpochId: successorEpochId,
  });
  const predecessorKeyEpoch = readContainerKeyEpoch(
    rootKek.keyEpoch,
    "predecessor key epoch",
  );
  const predecessorKeyEpochHash =
    await computeContainerKeyEpochHash(predecessorKeyEpoch);
  const predecessor: PredecessorContainerKekResponse = {
    accessManifestHash: rootKek.accessManifestHash,
    bridge: bridge as unknown as Record<string, unknown>,
    containerId: rootKek.containerId,
    containerKeyEpoch: rootKek.containerKeyEpoch,
    containerKeyEpochId: rootKek.containerKeyEpochId,
    keyEpoch: rootKek.keyEpoch,
    keyEpochHash: predecessorKeyEpochHash,
    parentContainerKeyEpochId: null,
  };
  const successor = {
    ...rootKek,
    containerKeyEpoch: successorEpoch,
    containerKeyEpochId: successorEpochId,
    keyEpoch: successorKeyEpoch as unknown as Record<string, unknown>,
    keyEpochHash: await computeContainerKeyEpochHash(successorKeyEpoch),
    predecessorKeks: [predecessor],
    wraps: [
      await createUserContainerWrap({
        containerKeyEpochId: successorEpochId,
        containerKek: successorKey,
        publicKey: fixture.publicKey,
        userId: "user-1",
        wrapManifestHash: rootKek.accessManifestHash,
      }),
    ],
  };
  return {
    childKek: {
      ...childKek,
      wraps: childKek.wraps.map((wrap) => ({
        ...wrap,
        recipientKeyFingerprint: predecessorKeyEpochHash,
      })),
    },
    fixture,
    predecessor,
    successor,
    successorEpochId,
  };
}

test("unwrapContainerKekPath derives history and then resolves a descendant pinned to it", async () => {
  const { childKek, fixture, predecessor, successor, successorEpochId } =
    await rotateRootKekFixture();
  const unwrapped = await unwrapContainerKekPath({
    projection: {
      ...fixture.projection,
      containerKeks: [successor, childKek],
    },
    secretKey: fixture.secretKey,
    trustedLocalProjection: true,
  });

  expect(unwrapped.has(successorEpochId)).toBe(true);
  expect(unwrapped.has(predecessor.containerKeyEpochId)).toBe(true);
  expect(unwrapped.has(childKek.containerKeyEpochId)).toBe(true);
});

test("unwrapContainerKekPath rejects incomplete or inconsistent predecessor chains", async () => {
  const { childKek, fixture, predecessor, successor } =
    await rotateRootKekFixture();
  const unwrap = (root: typeof successor) =>
    unwrapContainerKekPath({
      projection: { ...fixture.projection, containerKeks: [root, childKek] },
      secretKey: fixture.secretKey,
      trustedLocalProjection: true,
    });

  await expect(unwrap({ ...successor, predecessorKeks: [] })).rejects.toThrow(
    "predecessor chain is incomplete",
  );
  await expect(
    unwrap({
      ...successor,
      predecessorKeks: [
        {
          ...predecessor,
          bridge: {
            ...predecessor.bridge,
            containerId: "different-container",
          },
        },
      ],
    }),
  ).rejects.toThrow("predecessor bridge is inconsistent");
});

import { expect, test } from "bun:test";
import {
  createProjection,
  createWrappedProjection,
  fixtureHash,
  getOnlyTarget,
} from "../../../../test/helpers/documentFixtures";
import { unwrapContainerKekPath } from "./projection";

test("deriveDocumentCreateTargets uses the leaf projection manifest and KEK", async () => {
  const projection = await createProjection();
  const currentManifest = projection.path[0];
  const currentKek = projection.containerKeks[0];
  if (!currentManifest || !currentKek) {
    throw new Error("Expected test projection to include current state");
  }
  const staleManifestHash = await fixtureHash("stale-container-manifest");
  const staleKeyEpochHash = await fixtureHash("stale-container-key-epoch");
  const staleKeyTargetHash = await fixtureHash("stale-container-key-target");
  const staleManifest = {
    ...currentManifest,
    manifestHash: staleManifestHash,
  };
  const staleKek = {
    ...currentKek,
    accessManifestHash: staleManifestHash,
    containerKeyEpochId: "container-key-epoch-stale",
    containerKeyEpoch: 1,
    keyEpochHash: staleKeyEpochHash,
    keyTargetHash: staleKeyTargetHash,
  };
  const target = getOnlyTarget({
    ...projection,
    path: [staleManifest, ...projection.path],
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
    unwrapContainerKekPath({
      projection,
      secretKey,
    } as Parameters<typeof unwrapContainerKekPath>[0]),
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
  const childKek = projection.containerKeks[1];
  if (!childKek) {
    throw new Error("Expected child container KEK fixture");
  }

  await expect(
    unwrapContainerKekPath({
      projection: {
        ...projection,
        containerKeks: [childKek],
      },
      secretKey,
      trustedLocalProjection: true,
    }),
  ).rejects.toThrow("inconsistent");

  await expect(
    unwrapContainerKekPath({
      projection: {
        ...projection,
        containerKeks: [
          projection.containerKeks[0] ?? childKek,
          {
            ...childKek,
            wraps: childKek.wraps.map((wrap) => ({
              ...wrap,
              recipientKeyFingerprint: "wrong-parent-key-epoch-hash",
            })),
          },
        ],
      },
      secretKey,
      trustedLocalProjection: true,
    }),
  ).rejects.toThrow("could not be unwrapped");
});

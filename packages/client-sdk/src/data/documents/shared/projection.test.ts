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

  const rootKek = projection.containerKeks[0];
  const childKek = projection.containerKeks[1];
  if (!rootKek || !childKek) {
    throw new Error("Expected root and child container KEK fixtures");
  }
  const legacyEpochId = "legacy-container-key-epoch";
  await expect(
    unwrapContainerKekPath({
      projection: {
        ...projection,
        containerKeks: [
          {
            ...rootKek,
            containerKeyEpochId: legacyEpochId,
            keyEpoch: { ...rootKek.keyEpoch, id: legacyEpochId },
            wraps: rootKek.wraps.map((wrap) => ({
              ...wrap,
              containerKeyEpochId: legacyEpochId,
            })),
          },
          childKek,
        ],
      },
      secretKey,
      trustedLocalProjection: true,
    }),
  ).rejects.toThrow("KEK epoch id does not commit to key material");

  await expect(
    unwrapContainerKekPath({
      projection: { ...projection, containerKeks: [childKek] },
      secretKey,
      trustedLocalProjection: true,
    }),
  ).rejects.toThrow("inconsistent");

  await expect(
    unwrapContainerKekPath({
      projection: {
        ...projection,
        containerKeks: [
          rootKek,
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

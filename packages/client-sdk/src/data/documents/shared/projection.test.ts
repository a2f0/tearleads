import { expect, test } from "bun:test";
import {
  computeContainerKekMaterialId,
  generateKemSeedAndKeyPair,
} from "@tearleads/crypto";
import type { HistoricalContainerKekResponse } from "@tearleads/validators/response";
import {
  createContainerWrap,
  createProjection,
  createUserContainerWrap,
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
            keyEpoch: {
              ...rootKek.keyEpoch,
              id: legacyEpochId,
            },
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

async function createHistoricalUserKek(input: {
  containerId: string;
  keyEpoch: number;
  publicKey: Uint8Array;
  keyMaterial?: Uint8Array;
}): Promise<{
  historical: HistoricalContainerKekResponse;
  keyMaterial: Uint8Array;
}> {
  const keyMaterial =
    input.keyMaterial ?? crypto.getRandomValues(new Uint8Array(32));
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId: input.containerId,
    keyEpoch: input.keyEpoch,
    keyMaterial,
  });
  const wrapManifestHash = await fixtureHash(
    `historical-manifest-${containerKeyEpochId}`,
  );
  return {
    historical: {
      accessManifestHash: wrapManifestHash,
      containerId: input.containerId,
      containerKeyEpoch: input.keyEpoch,
      containerKeyEpochId,
      keyEpochHash: await fixtureHash(
        `historical-key-epoch-${containerKeyEpochId}`,
      ),
      parentContainerKeyEpochId: null,
      wraps: [
        await createUserContainerWrap({
          containerKeyEpochId,
          containerKek: keyMaterial,
          publicKey: input.publicKey,
          userId: "user-1",
          wrapManifestHash,
        }),
      ],
    },
    keyMaterial,
  };
}

test("unwrapContainerKekPath unwraps served historical epochs and skips epochs outside the member's audience", async () => {
  const { projection, publicKey, secretKey } = await createWrappedProjection();
  const rootKek = projection.containerKeks[0];
  const childKek = projection.containerKeks[1];
  if (!rootKek || !childKek) {
    throw new Error("Expected root and child container KEK fixtures");
  }
  const keyPair = generateKemSeedAndKeyPair();

  // A superseded root epoch the member can unwrap directly...
  const spanned = await createHistoricalUserKek({
    containerId: rootKek.containerId,
    keyEpoch: 1,
    publicKey,
  });
  // ...one wrapped only to someone else's key (skipped, not fatal)...
  const foreign = await createHistoricalUserKek({
    containerId: rootKek.containerId,
    keyEpoch: 1,
    publicKey: keyPair.publicKey,
  });
  // ...and a superseded child epoch wrapped to the SUPERSEDED root epoch
  // above (the shape the server serves — container wraps never target a
  // current epoch), so it must resolve through the historical parent chain
  // unwrapped earlier in path order.
  const childHistoricalKey = crypto.getRandomValues(new Uint8Array(32));
  const childHistoricalEpochId = await computeContainerKekMaterialId({
    containerId: childKek.containerId,
    keyEpoch: 1,
    keyMaterial: childHistoricalKey,
  });
  const childHistorical: HistoricalContainerKekResponse = {
    accessManifestHash: await fixtureHash("historical-child-manifest"),
    containerId: childKek.containerId,
    containerKeyEpoch: 1,
    containerKeyEpochId: childHistoricalEpochId,
    keyEpochHash: await fixtureHash("historical-child-key-epoch"),
    parentContainerKeyEpochId: spanned.historical.containerKeyEpochId,
    wraps: [
      await createContainerWrap({
        childContainerKeyEpochId: childHistoricalEpochId,
        childKek: childHistoricalKey,
        parentContainerId: rootKek.containerId,
        parentContainerKeyEpochId: spanned.historical.containerKeyEpochId,
        parentKeyEpochHash: spanned.historical.keyEpochHash,
        parentKek: spanned.keyMaterial,
        wrapManifestHash: await fixtureHash("historical-child-manifest"),
      }),
    ],
  };

  const unwrapped = await unwrapContainerKekPath({
    projection: {
      ...projection,
      containerKeks: [
        {
          ...rootKek,
          historicalKeks: [spanned.historical, foreign.historical],
        },
        { ...childKek, historicalKeks: [childHistorical] },
      ],
    },
    secretKey,
    trustedLocalProjection: true,
  });

  expect(
    Array.from(unwrapped.get(spanned.historical.containerKeyEpochId) ?? []),
  ).toEqual(Array.from(spanned.keyMaterial));
  expect(Array.from(unwrapped.get(childHistoricalEpochId) ?? [])).toEqual(
    Array.from(childHistoricalKey),
  );
  expect(unwrapped.has(foreign.historical.containerKeyEpochId)).toBe(false);
});

test("unwrapContainerKekPath resolves a descendant still wrapped to an ancestor's superseded epoch", async () => {
  const { projection, publicKey, secretKey } = await createWrappedProjection();
  const rootKek = projection.containerKeks[0];
  const childKek = projection.containerKeks[1];
  if (!rootKek || !childKek) {
    throw new Error("Expected root and child container KEK fixtures");
  }

  // The root rotated to a fresh epoch, but the child has not been rekeyed:
  // its CURRENT epoch still wraps to the root's superseded epoch, which now
  // travels as a historical entry. The path walk must unwrap that historical
  // epoch before attempting the child, or the child (the unwrap target)
  // fails outright.
  const rotatedRootKey = crypto.getRandomValues(new Uint8Array(32));
  const rotatedRootEpochId = await computeContainerKekMaterialId({
    containerId: rootKek.containerId,
    keyEpoch: 2,
    keyMaterial: rotatedRootKey,
  });
  const supersededRoot: HistoricalContainerKekResponse = {
    accessManifestHash: rootKek.accessManifestHash,
    containerId: rootKek.containerId,
    containerKeyEpoch: rootKek.containerKeyEpoch,
    containerKeyEpochId: rootKek.containerKeyEpochId,
    keyEpochHash: rootKek.keyEpochHash,
    parentContainerKeyEpochId: null,
    wraps: rootKek.wraps,
  };
  const rotatedRootKek = {
    ...rootKek,
    containerKeyEpoch: 2,
    containerKeyEpochId: rotatedRootEpochId,
    historicalKeks: [supersededRoot],
    keyEpoch: {
      ...rootKek.keyEpoch,
      id: rotatedRootEpochId,
      keyEpoch: 2,
    },
    keyEpochHash: await fixtureHash("rotated-root-key-epoch"),
    wraps: [
      await createUserContainerWrap({
        containerKeyEpochId: rotatedRootEpochId,
        containerKek: rotatedRootKey,
        publicKey,
        userId: "user-1",
        wrapManifestHash: rootKek.accessManifestHash,
      }),
    ],
  };

  const unwrapped = await unwrapContainerKekPath({
    projection: {
      ...projection,
      containerKeks: [rotatedRootKek, childKek],
    },
    secretKey,
    trustedLocalProjection: true,
  });

  expect(unwrapped.has(rotatedRootEpochId)).toBe(true);
  expect(unwrapped.has(rootKek.containerKeyEpochId)).toBe(true);
  expect(unwrapped.has(childKek.containerKeyEpochId)).toBe(true);
});

test("unwrapContainerKekPath rejects historical epochs whose material or wraps do not commit", async () => {
  const { projection, publicKey, secretKey } = await createWrappedProjection();
  const rootKek = projection.containerKeks[0];
  if (!rootKek) {
    throw new Error("Expected root container KEK fixture");
  }

  // The epoch id commits to DIFFERENT material than the wrap delivers: the
  // unwrap succeeds mechanically but the commitment check must refuse it, so
  // a server cannot substitute key material for a referenced epoch.
  const substituted = await createHistoricalUserKek({
    containerId: rootKek.containerId,
    keyEpoch: 1,
    publicKey,
  });
  const substitutedId = await computeContainerKekMaterialId({
    containerId: rootKek.containerId,
    keyEpoch: 1,
    keyMaterial: crypto.getRandomValues(new Uint8Array(32)),
  });
  await expect(
    unwrapContainerKekPath({
      projection: {
        ...projection,
        containerKeks: [
          {
            ...rootKek,
            historicalKeks: [
              {
                ...substituted.historical,
                containerKeyEpochId: substitutedId,
                wraps: substituted.historical.wraps.map((wrap) => ({
                  ...wrap,
                  containerKeyEpochId: substitutedId,
                })),
              },
            ],
          },
          ...projection.containerKeks.slice(1),
        ],
      },
      secretKey,
      trustedLocalProjection: true,
    }),
  ).rejects.toThrow("KEK material does not match committed epoch id");

  // A wrap belonging to a different epoch id must be rejected outright.
  const mismatched = await createHistoricalUserKek({
    containerId: rootKek.containerId,
    keyEpoch: 1,
    publicKey,
  });
  await expect(
    unwrapContainerKekPath({
      projection: {
        ...projection,
        containerKeks: [
          {
            ...rootKek,
            historicalKeks: [
              {
                ...mismatched.historical,
                wraps: mismatched.historical.wraps.map((wrap) => ({
                  ...wrap,
                  containerKeyEpochId: "some-other-epoch",
                })),
              },
            ],
          },
          ...projection.containerKeks.slice(1),
        ],
      },
      secretKey,
      trustedLocalProjection: true,
    }),
  ).rejects.toThrow("historical epoch contains a stale wrap");
});

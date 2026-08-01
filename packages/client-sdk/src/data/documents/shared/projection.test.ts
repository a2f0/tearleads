import { expect, test } from "bun:test";
import {
  computeContainerKekMaterialId,
  computeContainerKeyEpochHash,
  createContainerKekPredecessorBridge,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  encryptWithDek,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  DocumentContentKeyBundleResponse,
  DocumentWriterProjectionResponse,
  PredecessorContainerKekResponse,
} from "@tearleads/validators/response";
import {
  createProjection,
  createUserContainerWrap,
  createWrappedProjection,
  fixtureHash,
  getOnlyTarget,
} from "../../../../test/helpers/documentFixtures";
import { readContainerKeyEpoch } from "../../keyingProjectionVerification/readers";
import {
  collectContainerKeksForDocumentSync,
  unwrapContainerKekPath,
  unwrapDocumentContentKeyFromBundle,
} from "./projection";

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
    successorKey,
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

test("document projection caches an unbounded predecessor chain across paths", async () => {
  const rotated = await rotateRootKekFixture();
  const currentManifest = rotated.fixture.projection.path[0];
  if (!currentManifest) {
    throw new Error("Expected a root container manifest fixture");
  }
  let current = rotated.successor;
  let currentKey = rotated.successorKey;
  for (let keyEpoch = 3; keyEpoch <= 6; keyEpoch += 1) {
    const successorKey = crypto.getRandomValues(new Uint8Array(32));
    const successorId = await computeContainerKekMaterialId({
      containerId: current.containerId,
      keyEpoch,
      keyMaterial: successorKey,
    });
    const bridge = await createContainerKekPredecessorBridge({
      containerId: current.containerId,
      predecessorContainerKey: currentKey,
      predecessorContainerKeyEpochId: current.containerKeyEpochId,
      successorContainerKey: successorKey,
      successorContainerKeyEpochId: successorId,
    });
    const predecessor: PredecessorContainerKekResponse = {
      accessManifestHash: current.accessManifestHash,
      bridge: bridge as unknown as Record<string, unknown>,
      containerId: current.containerId,
      containerKeyEpoch: current.containerKeyEpoch,
      containerKeyEpochId: current.containerKeyEpochId,
      keyEpoch: current.keyEpoch,
      keyEpochHash: current.keyEpochHash,
      parentContainerKeyEpochId: current.parentContainerKeyEpochId,
    };
    const keyEpochRecord = {
      ...readContainerKeyEpoch(current.keyEpoch, "current key epoch"),
      id: successorId,
      keyEpoch,
    };
    current = {
      ...current,
      containerKeyEpoch: keyEpoch,
      containerKeyEpochId: successorId,
      keyEpoch: keyEpochRecord as unknown as Record<string, unknown>,
      keyEpochHash: await computeContainerKeyEpochHash(keyEpochRecord),
      predecessorKeks: [predecessor, ...current.predecessorKeks],
      wraps: [
        await createUserContainerWrap({
          containerKeyEpochId: successorId,
          containerKek: successorKey,
          publicKey: rotated.fixture.publicKey,
          userId: "user-1",
          wrapManifestHash: current.accessManifestHash,
        }),
      ],
    };
    currentKey = successorKey;
  }
  const projection = {
    ...rotated.fixture.projection,
    containerId: current.containerId,
    containerKeks: [current],
    path: [currentManifest],
  };
  const cachedCopy = structuredClone(projection);
  const cachedBridge = cachedCopy.containerKeks[0]?.predecessorKeks[0]?.bridge;
  if (!cachedBridge) {
    throw new Error("Expected a cached predecessor bridge fixture");
  }
  Object.assign(cachedBridge, {
    wrappedKey: bytesToBase64(new Uint8Array(48)),
  });

  const collected = await collectContainerKeksForDocumentSync({
    writerProjection: {
      authorizingContainerPaths: [projection, cachedCopy],
    } as unknown as DocumentWriterProjectionResponse,
    secretKey: rotated.fixture.secretKey,
    trustedLocalProjection: true,
  });

  expect(collected.keksByEpochId.size).toBe(6);
  expect(collected.predecessorFailuresByContainerId.size).toBe(0);
});

test("unwrapContainerKekPath rejects incomplete or inconsistent predecessor chains", async () => {
  const { childKek, fixture, predecessor, successor, successorKey } =
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

  const substitutedBridge = await createContainerKekPredecessorBridge({
    containerId: predecessor.containerId,
    predecessorContainerKey: crypto.getRandomValues(new Uint8Array(32)),
    predecessorContainerKeyEpochId: predecessor.containerKeyEpochId,
    successorContainerKey: successorKey,
    successorContainerKeyEpochId: successor.containerKeyEpochId,
  });
  await expect(
    unwrap({
      ...successor,
      predecessorKeks: [
        {
          ...predecessor,
          bridge: substitutedBridge as unknown as Record<string, unknown>,
        },
      ],
    }),
  ).rejects.toThrow("KEK material does not match committed epoch id");
});

test("unwrapContainerKekPath retains a verified current KEK when history is corrupt", async () => {
  const { fixture, predecessor, successor, successorKey } =
    await rotateRootKekFixture();
  const currentManifest = fixture.projection.path[0];
  if (!currentManifest) {
    throw new Error("Expected a root container manifest fixture");
  }
  const corruptBridge = await createContainerKekPredecessorBridge({
    containerId: predecessor.containerId,
    predecessorContainerKey: crypto.getRandomValues(new Uint8Array(32)),
    predecessorContainerKeyEpochId: predecessor.containerKeyEpochId,
    successorContainerKey: successorKey,
    successorContainerKeyEpochId: successor.containerKeyEpochId,
  });

  const unwrapped = await unwrapContainerKekPath({
    projection: {
      ...fixture.projection,
      containerId: successor.containerId,
      containerKeks: [
        {
          ...successor,
          predecessorKeks: [
            {
              ...predecessor,
              bridge: corruptBridge as unknown as Record<string, unknown>,
            },
          ],
        },
      ],
      path: [currentManifest],
    },
    secretKey: fixture.secretKey,
    trustedLocalProjection: true,
  });

  expect(
    Array.from(unwrapped.get(successor.containerKeyEpochId) ?? []),
  ).toEqual(Array.from(successorKey));
  expect(unwrapped.has(predecessor.containerKeyEpochId)).toBe(false);
});

test("document unwrap reports corrupt history when its content key needs that epoch", async () => {
  const { fixture, predecessor, successor, successorKey } =
    await rotateRootKekFixture();
  const currentManifest = fixture.projection.path[0];
  if (!currentManifest) {
    throw new Error("Expected a root container manifest fixture");
  }
  const corruptBridge = await createContainerKekPredecessorBridge({
    containerId: predecessor.containerId,
    predecessorContainerKey: crypto.getRandomValues(new Uint8Array(32)),
    predecessorContainerKeyEpochId: predecessor.containerKeyEpochId,
    successorContainerKey: successorKey,
    successorContainerKeyEpochId: successor.containerKeyEpochId,
  });
  const rootProjection = {
    ...fixture.projection,
    containerId: successor.containerId,
    containerKeks: [
      {
        ...successor,
        predecessorKeks: [
          {
            ...predecessor,
            bridge: corruptBridge as unknown as Record<string, unknown>,
          },
        ],
      },
    ],
    path: [currentManifest],
  };
  const collectedKeks = await collectContainerKeksForDocumentSync({
    writerProjection: {
      authorizingContainerPaths: [rootProjection],
    } as unknown as DocumentWriterProjectionResponse,
    secretKey: fixture.secretKey,
    trustedLocalProjection: true,
  });
  expect(
    collectedKeks.keksByEpochId.get(successor.containerKeyEpochId),
  ).toEqual(successorKey);

  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await encryptWithDek(contentKey, fixture.rootContainerKek);
  const bundle = {
    contentKeyEpoch: 1,
    documentId: crypto.randomUUID(),
    linkSetManifestHash: await fixtureHash("history-link-set"),
    targetHash: await fixtureHash("history-targets"),
    targets: [
      {
        containerId: predecessor.containerId,
        containerKeyEpoch: predecessor.containerKeyEpoch,
        containerKeyEpochId: predecessor.containerKeyEpochId,
        containerManifestHash: predecessor.accessManifestHash,
        wrappedKey: bytesToBase64(wrapped.ciphertext),
        wrappingMetadata: {
          suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
          iv: bytesToBase64(wrapped.iv),
        },
      },
    ],
  } satisfies DocumentContentKeyBundleResponse;

  await expect(
    unwrapDocumentContentKeyFromBundle(
      bundle,
      collectedKeks.keksByEpochId,
      collectedKeks.predecessorFailuresByContainerId,
    ),
  ).rejects.toThrow("KEK material does not match committed epoch id");
});

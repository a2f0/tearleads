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
  createUserContainerWrap,
  createWrappedProjection,
  fixtureHash,
} from "../../../../test/helpers/documentFixtures";
import { readContainerKeyEpoch } from "../../keyingProjectionVerification/readers";
import {
  collectContainerKeksForDocumentSync,
  unwrapContainerKekPath,
  unwrapDocumentContentKeyFromBundle,
} from "./projection";

async function rotateRootKekFixture() {
  const fixture = await createWrappedProjection();
  const rootKek = fixture.projection.containerKeks[0];
  const childKek = fixture.projection.containerKeks[1];
  const rootManifest = fixture.projection.path[0];
  if (!rootKek || !childKek || !rootManifest) {
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
    containerManifestHistory: [
      {
        ...rootManifest,
        state: {
          ...rootManifest.state,
          containerKeyEpochId: rootKek.containerKeyEpochId,
        },
      },
    ],
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
  const partialProjection = structuredClone(projection);
  const partialKek = partialProjection.containerKeks[0];
  if (!partialKek) {
    throw new Error("Expected a partial predecessor fixture");
  }
  const missingPredecessor = partialKek.predecessorKeks.pop();
  if (!missingPredecessor) {
    throw new Error("Expected an omitted predecessor fixture");
  }
  const partial = await collectContainerKeksForDocumentSync({
    writerProjection: {
      authorizingContainerPaths: [partialProjection],
    } as unknown as DocumentWriterProjectionResponse,
    secretKey: rotated.fixture.secretKey,
    trustedLocalProjection: true,
  });
  expect(partial.keksByEpochId.size).toBe(5);
  expect(
    partial.predecessorFailuresByEpochId.get(
      missingPredecessor.containerKeyEpochId,
    )?.message,
  ).toContain("predecessor chain is incomplete");
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
  expect(collected.predecessorFailuresByEpochId.size).toBe(0);
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
      collectedKeks.predecessorFailuresByEpochId,
    ),
  ).rejects.toThrow("KEK material does not match committed epoch id");
});

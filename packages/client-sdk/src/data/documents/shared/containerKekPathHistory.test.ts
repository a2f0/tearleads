import { expect, test } from "bun:test";
import {
  computeContainerKekMaterialId,
  computeDocumentContentKeyTargetHash,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  encryptWithDek,
  sealContainerKekKeyring,
} from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import type {
  ContainerWriterProjectionResponse,
  DocumentContentKeyBundleResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import { fixtureHash } from "../../../../test/helpers/documentFixtures";
import {
  type KeyringRotationFixture,
  rotateRootKekKeyringFixture,
  tamperSealedKeyring,
} from "../../../../test/helpers/keyringRotationFixtures";
import {
  ContainerKekHistoryUnavailableError,
  collectContainerKeksForDocumentSync,
  DocumentHistoryUnavailableError,
  unwrapContainerKekPath,
  unwrapDocumentContentKeyFromBundle,
} from "./projection";
import { targetEnvelopeReference } from "./readers";

type ProjectionKek = ContainerWriterProjectionResponse["containerKeks"][number];

function rootOnlyProjection(
  rotated: KeyringRotationFixture,
  kek: ProjectionKek = rotated.successor,
): ContainerWriterProjectionResponse {
  return {
    ...rotated.fixture.projection,
    containerId: kek.containerId,
    containerKeks: [kek],
    path: [rotated.currentManifest],
  };
}

function writerProjectionFor(
  authorizingContainerPaths: ContainerWriterProjectionResponse[],
): DocumentWriterProjectionResponse {
  return {
    authorizingContainerPaths,
  } as unknown as DocumentWriterProjectionResponse;
}

async function wrapContentKeyToEpoch1(rotated: KeyringRotationFixture) {
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await encryptWithDek(
    contentKey,
    rotated.fixture.rootContainerKek,
  );
  const target = {
    containerId: rotated.successor.containerId,
    containerKeyEpoch: 1,
    containerKeyEpochId: rotated.predecessorEpochId,
    containerManifestHash: rotated.successor.accessManifestHash,
    wrappedKey: bytesToBase64(wrapped.ciphertext),
    wrappingMetadata: {
      suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
      iv: bytesToBase64(wrapped.iv),
    },
  };
  const bundle = {
    contentKeyEpoch: 1,
    documentId: crypto.randomUUID(),
    linkSetManifestHash: await fixtureHash("history-link-set"),
    targetHash: await computeDocumentContentKeyTargetHash([
      targetEnvelopeReference(target),
    ]),
    targets: [target],
  } satisfies DocumentContentKeyBundleResponse;

  return { bundle, contentKey };
}

test("cold unwrap recovers every epoch of a twice-rotated container from the keyring", async () => {
  const rotated = await rotateRootKekKeyringFixture(2);
  const collected = await collectContainerKeksForDocumentSync({
    writerProjection: writerProjectionFor([rootOnlyProjection(rotated)]),
    secretKey: rotated.fixture.secretKey,
    trustedLocalProjection: true,
  });

  expect(rotated.epochIds).toHaveLength(3);
  expect(collected.keksByEpochId.size).toBe(3);
  expect(collected.predecessorFailuresByEpochId.size).toBe(0);
  rotated.epochIds.forEach((containerKeyEpochId, index) => {
    expect(
      Array.from(collected.keksByEpochId.get(containerKeyEpochId) ?? []),
    ).toEqual(Array.from(rotated.epochKeys[index] ?? []));
  });

  const { bundle, contentKey } = await wrapContentKeyToEpoch1(rotated);
  const unwrappedContentKey = await unwrapDocumentContentKeyFromBundle(
    bundle,
    collected.keksByEpochId,
    collected.predecessorFailuresByEpochId,
  );
  expect(Array.from(unwrappedContentKey)).toEqual(Array.from(contentKey));
});

test("document projection shares keyring-recovered keys across authorizing paths", async () => {
  const rotated = await rotateRootKekKeyringFixture();
  const projection = rootOnlyProjection(rotated);
  const damagedCopy = structuredClone(projection);
  const damagedKek = damagedCopy.containerKeks[0];
  if (!damagedKek?.keyring) {
    throw new Error("Expected a damaged keyring fixture");
  }
  damagedKek.keyring = tamperSealedKeyring(damagedKek.keyring);

  const damagedAlone = await collectContainerKeksForDocumentSync({
    writerProjection: writerProjectionFor([structuredClone(damagedCopy)]),
    secretKey: rotated.fixture.secretKey,
    trustedLocalProjection: true,
  });
  expect(damagedAlone.keksByEpochId.has(rotated.predecessorEpochId)).toBe(
    false,
  );
  expect(
    damagedAlone.predecessorFailuresByEpochId.has(rotated.predecessorEpochId),
  ).toBe(true);

  // The intact path recovers the historical key, and the damaged copy alongside
  // it cannot take that recovery away: the shared map still serves the epoch.
  const collected = await collectContainerKeksForDocumentSync({
    writerProjection: writerProjectionFor([projection, damagedCopy]),
    secretKey: rotated.fixture.secretKey,
    trustedLocalProjection: true,
  });

  expect(collected.keksByEpochId.size).toBe(2);
  expect(
    Array.from(collected.keksByEpochId.get(rotated.predecessorEpochId) ?? []),
  ).toEqual(Array.from(rotated.fixture.rootContainerKek));

  // A recovered key outranks the damaged copy's own history failure, so a
  // document pinned to the historical epoch still reads.
  const { bundle, contentKey } = await wrapContentKeyToEpoch1(rotated);
  const unwrappedContentKey = await unwrapDocumentContentKeyFromBundle(
    bundle,
    collected.keksByEpochId,
    collected.predecessorFailuresByEpochId,
  );
  expect(Array.from(unwrappedContentKey)).toEqual(Array.from(contentKey));
});

test("shared-path integrity failures outrank unavailable history in either order", async () => {
  const rotated = await rotateRootKekKeyringFixture();
  const unavailable = rootOnlyProjection(rotated, {
    ...rotated.successor,
    keyring: null,
  });
  const damaged = structuredClone(rootOnlyProjection(rotated));
  const damagedKek = damaged.containerKeks[0];
  if (!damagedKek?.keyring) throw new Error("Expected a damaged keyring");
  damagedKek.keyring = tamperSealedKeyring(damagedKek.keyring);
  const { bundle } = await wrapContentKeyToEpoch1(rotated);

  for (const paths of [
    [unavailable, damaged],
    [damaged, unavailable],
  ]) {
    const collected = await collectContainerKeksForDocumentSync({
      writerProjection: writerProjectionFor(paths),
      secretKey: rotated.fixture.secretKey,
      trustedLocalProjection: true,
    });
    const error = await unwrapDocumentContentKeyFromBundle(
      bundle,
      collected.keksByEpochId,
      collected.predecessorFailuresByEpochId,
      collected.unattributedPredecessorFailuresByContainerId,
    ).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(DocumentHistoryUnavailableError);
    expect(
      (error as DocumentHistoryUnavailableError).historyCause,
    ).not.toBeInstanceOf(ContainerKekHistoryUnavailableError);
  }
});

test("unwrapContainerKekPath rejects missing or inconsistent keyrings", async () => {
  const rotated = await rotateRootKekKeyringFixture();
  const { childKek, fixture, keyring, successor } = rotated;
  const unwrap = (root: ProjectionKek) =>
    unwrapContainerKekPath({
      projection: { ...fixture.projection, containerKeks: [root, childKek] },
      secretKey: fixture.secretKey,
      trustedLocalProjection: true,
    });

  await expect(unwrap({ ...successor, keyring: null })).rejects.toThrow(
    "keyring is missing",
  );
  await expect(
    unwrap({
      ...successor,
      keyring: { ...keyring, containerKeyEpochId: rotated.predecessorEpochId },
    }),
  ).rejects.toThrow("keyring is inconsistent");

  const fillerKey = crypto.getRandomValues(new Uint8Array(32));
  const oversizedKeyring = await sealContainerKekKeyring({
    containerId: successor.containerId,
    entries: [
      {
        containerKeyEpochId: rotated.predecessorEpochId,
        keyMaterial: fixture.rootContainerKek,
      },
      {
        containerKeyEpochId: await computeContainerKekMaterialId({
          containerId: successor.containerId,
          keyEpoch: 2,
          keyMaterial: fillerKey,
        }),
        keyMaterial: fillerKey,
      },
    ],
    keyEpoch: 3,
    successorContainerKey: rotated.currentKey,
    successorContainerKeyEpochId: successor.containerKeyEpochId,
  });
  await expect(
    unwrap({ ...successor, keyring: oversizedKeyring }),
  ).rejects.toThrow("sealed length does not match its key epoch");

  const substitutedKeyring = await sealContainerKekKeyring({
    containerId: successor.containerId,
    entries: [
      {
        containerKeyEpochId: rotated.predecessorEpochId,
        keyMaterial: crypto.getRandomValues(new Uint8Array(32)),
      },
    ],
    keyEpoch: 2,
    successorContainerKey: rotated.currentKey,
    successorContainerKeyEpochId: successor.containerKeyEpochId,
  });
  await expect(
    unwrap({ ...successor, keyring: substitutedKeyring }),
  ).rejects.toThrow("does not match its committed epoch id");
});

test("unwrapContainerKekPath retains a verified current KEK when history is corrupt", async () => {
  const rotated = await rotateRootKekKeyringFixture();
  const unwrapped = await unwrapContainerKekPath({
    projection: rootOnlyProjection(rotated, {
      ...rotated.successor,
      keyring: tamperSealedKeyring(rotated.keyring),
    }),
    secretKey: rotated.fixture.secretKey,
    trustedLocalProjection: true,
  });

  expect(Array.from(unwrapped.get(rotated.currentEpochId) ?? [])).toEqual(
    Array.from(rotated.currentKey),
  );
  expect(unwrapped.has(rotated.predecessorEpochId)).toBe(false);
});

test("document unwrap reports corrupt history when its content key needs that epoch", async () => {
  const rotated = await rotateRootKekKeyringFixture();
  const substitutedKeyring = await sealContainerKekKeyring({
    containerId: rotated.successor.containerId,
    entries: [
      {
        containerKeyEpochId: rotated.predecessorEpochId,
        keyMaterial: crypto.getRandomValues(new Uint8Array(32)),
      },
    ],
    keyEpoch: rotated.successor.containerKeyEpoch,
    successorContainerKey: rotated.currentKey,
    successorContainerKeyEpochId: rotated.currentEpochId,
  });
  const collectedKeks = await collectContainerKeksForDocumentSync({
    writerProjection: writerProjectionFor([
      rootOnlyProjection(rotated, {
        ...rotated.successor,
        keyring: substitutedKeyring,
      }),
    ]),
    secretKey: rotated.fixture.secretKey,
    trustedLocalProjection: true,
  });
  expect(collectedKeks.keksByEpochId.get(rotated.currentEpochId)).toEqual(
    rotated.currentKey,
  );
  expect(collectedKeks.keksByEpochId.has(rotated.predecessorEpochId)).toBe(
    false,
  );

  const { bundle } = await wrapContentKeyToEpoch1(rotated);
  const error = await unwrapDocumentContentKeyFromBundle(
    bundle,
    collectedKeks.keksByEpochId,
    collectedKeks.predecessorFailuresByEpochId,
  ).then(
    () => {
      throw new Error("Expected the historical read to fail");
    },
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(DocumentHistoryUnavailableError);
  expect((error as Error).message).toContain(
    "does not match its committed epoch id",
  );
});

test("an ancestor rotation still lets a pinned descendant be opened", async () => {
  // The root rotates to epoch 2 while the child stays pinned to root epoch 1
  // through its parent wrap — the state a lazy rekey has not caught up with
  // yet. Opening the child needs the root's HISTORICAL KEK, which now comes
  // from the sealed keyring rather than a predecessor chain. If a
  // keyring-recovered key could not satisfy a parent wrap, this descendant
  // would be permanently unreachable: a cold client could neither read it nor
  // mint the rekey that would move it forward.
  const rotated = await rotateRootKekKeyringFixture();
  const projection: ContainerWriterProjectionResponse = {
    ...rotated.fixture.projection,
    containerId: rotated.successor.containerId,
    containerKeks: [rotated.successor, rotated.childKek],
  };

  const collected = await collectContainerKeksForDocumentSync({
    writerProjection: writerProjectionFor([projection]),
    secretKey: rotated.fixture.secretKey,
    trustedLocalProjection: true,
  });

  // The child's own epoch is recovered, which is only possible by unwrapping
  // its parent wrap under the root's keyring-recovered epoch-1 key.
  expect(
    collected.keksByEpochId.has(rotated.childKek.containerKeyEpochId),
  ).toBe(true);
  expect(collected.keksByEpochId.has(rotated.predecessorEpochId)).toBe(true);
});

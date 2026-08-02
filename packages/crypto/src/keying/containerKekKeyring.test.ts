import { expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { AES_GCM_TAG_BYTES } from "../symmetric";
import {
  assertSealedContainerKekKeyringLength,
  CONTAINER_KEK_KEYRING_ENTRY_BYTES,
  CONTAINER_KEK_KEYRING_HEADER_BYTES,
  computeContainerKekKeyringHash,
  expectedSealedContainerKekKeyringBytes,
  normalizeContainerKekKeyring,
  openContainerKekKeyring,
  sealContainerKekKeyring,
  verifyContainerKekKeyringEntry,
} from "./containerKekKeyring";
import { computeContainerKekMaterialId } from "./containerKekMaterial";
import type { ContainerKekKeyringEntry } from "./types";
import { MAX_CONTAINER_KEY_EPOCH } from "./types";

interface KeyringFixture {
  containerId: string;
  currentKey: Uint8Array;
  currentKeyEpochId: string;
  entries: ContainerKekKeyringEntry[];
  keyEpoch: number;
}

async function keyringFixture(keyEpoch: number): Promise<KeyringFixture> {
  const containerId = crypto.randomUUID();
  const entries: ContainerKekKeyringEntry[] = [];
  for (let epoch = 1; epoch < keyEpoch; epoch += 1) {
    const keyMaterial = crypto.getRandomValues(new Uint8Array(32));
    entries.push({
      containerKeyEpochId: await computeContainerKekMaterialId({
        containerId,
        keyEpoch: epoch,
        keyMaterial,
      }),
      keyMaterial,
    });
  }
  const currentKey = crypto.getRandomValues(new Uint8Array(32));
  return {
    containerId,
    currentKey,
    currentKeyEpochId: await computeContainerKekMaterialId({
      containerId,
      keyEpoch,
      keyMaterial: currentKey,
    }),
    entries,
    keyEpoch,
  };
}

function sealFixture(fixture: KeyringFixture) {
  return sealContainerKekKeyring({
    containerId: fixture.containerId,
    entries: fixture.entries,
    keyEpoch: fixture.keyEpoch,
    successorContainerKey: fixture.currentKey,
    successorContainerKeyEpochId: fixture.currentKeyEpochId,
  });
}

test("a sealed keyring reopens to its exact entries", async () => {
  const fixture = await keyringFixture(4);
  const keyring = await sealFixture(fixture);

  const reopened = await openContainerKekKeyring({
    keyEpoch: fixture.keyEpoch,
    keyring,
    successorContainerKey: fixture.currentKey,
  });

  expect(reopened).toHaveLength(3);
  for (const [index, entry] of reopened.entries()) {
    const sealed = fixture.entries[index];
    expect(entry.containerKeyEpochId).toBe(
      sealed?.containerKeyEpochId as string,
    );
    expect(entry.keyMaterial).toEqual(sealed?.keyMaterial as Uint8Array);
    await verifyContainerKekKeyringEntry({
      containerId: fixture.containerId,
      entry,
      keyEpoch: index + 1,
    });
  }
});

test("the sealed length is an equality in the key epoch", async () => {
  const fixture = await keyringFixture(5);
  const keyring = await sealFixture(fixture);

  expect(base64ToBytes(keyring.sealed).byteLength).toBe(
    expectedSealedContainerKekKeyringBytes(5),
  );
  expect(expectedSealedContainerKekKeyringBytes(5)).toBe(
    CONTAINER_KEK_KEYRING_HEADER_BYTES +
      4 * CONTAINER_KEK_KEYRING_ENTRY_BYTES +
      AES_GCM_TAG_BYTES,
  );
  assertSealedContainerKekKeyringLength(keyring, 5);
  expect(() => assertSealedContainerKekKeyringLength(keyring, 4)).toThrow(
    "does not match its key epoch",
  );
  expect(() => assertSealedContainerKekKeyringLength(keyring, 6)).toThrow(
    "does not match its key epoch",
  );
});

test("opening with the wrong key or wrong epoch fails closed", async () => {
  const fixture = await keyringFixture(3);
  const keyring = await sealFixture(fixture);

  await expect(
    openContainerKekKeyring({
      keyEpoch: fixture.keyEpoch,
      keyring,
      successorContainerKey: crypto.getRandomValues(new Uint8Array(32)),
    }),
  ).rejects.toThrow();
  await expect(
    openContainerKekKeyring({
      keyEpoch: 2,
      keyring,
      successorContainerKey: fixture.currentKey,
    }),
  ).rejects.toThrow("does not match its key epoch");
});

test("keyring metadata is authenticated", async () => {
  const fixture = await keyringFixture(3);
  const keyring = await sealFixture(fixture);
  const other = await keyringFixture(3);

  await expect(
    openContainerKekKeyring({
      keyEpoch: fixture.keyEpoch,
      keyring: { ...keyring, containerId: other.containerId },
      successorContainerKey: fixture.currentKey,
    }),
  ).rejects.toThrow();
  await expect(
    openContainerKekKeyring({
      keyEpoch: fixture.keyEpoch,
      keyring: { ...keyring, containerKeyEpochId: other.currentKeyEpochId },
      successorContainerKey: fixture.currentKey,
    }),
  ).rejects.toThrow();
});

test("a tampered sealed body fails AEAD", async () => {
  const fixture = await keyringFixture(3);
  const keyring = await sealFixture(fixture);
  const sealed = base64ToBytes(keyring.sealed);
  const flipped = sealed.slice();
  flipped[CONTAINER_KEK_KEYRING_HEADER_BYTES] =
    (flipped[CONTAINER_KEK_KEYRING_HEADER_BYTES] as number) ^ 0x01;

  await expect(
    openContainerKekKeyring({
      keyEpoch: fixture.keyEpoch,
      keyring: { ...keyring, sealed: bytesToBase64(flipped) },
      successorContainerKey: fixture.currentKey,
    }),
  ).rejects.toThrow();
});

test("a swapped entry fails per-entry material-id verification", async () => {
  const fixture = await keyringFixture(3);
  const [first, second] = fixture.entries;
  const swapped = await sealContainerKekKeyring({
    containerId: fixture.containerId,
    entries: [
      second as ContainerKekKeyringEntry,
      first as ContainerKekKeyringEntry,
    ],
    keyEpoch: fixture.keyEpoch,
    successorContainerKey: fixture.currentKey,
    successorContainerKeyEpochId: fixture.currentKeyEpochId,
  });
  const reopened = await openContainerKekKeyring({
    keyEpoch: fixture.keyEpoch,
    keyring: swapped,
    successorContainerKey: fixture.currentKey,
  });

  await expect(
    verifyContainerKekKeyringEntry({
      containerId: fixture.containerId,
      entry: reopened[0] as ContainerKekKeyringEntry,
      keyEpoch: 1,
    }),
  ).rejects.toThrow("does not match its committed epoch id");
});

test("sealing rejects an entry count that mismatches the key epoch", async () => {
  const fixture = await keyringFixture(4);

  await expect(
    sealContainerKekKeyring({
      containerId: fixture.containerId,
      entries: fixture.entries.slice(1),
      keyEpoch: fixture.keyEpoch,
      successorContainerKey: fixture.currentKey,
      successorContainerKeyEpochId: fixture.currentKeyEpochId,
    }),
  ).rejects.toThrow("exactly one entry per predecessor epoch");
});

test("sealing rejects reused key material", async () => {
  const fixture = await keyringFixture(3);
  const reused = fixture.entries[0] as ContainerKekKeyringEntry;

  await expect(
    sealContainerKekKeyring({
      containerId: fixture.containerId,
      entries: [reused, reused],
      keyEpoch: fixture.keyEpoch,
      successorContainerKey: fixture.currentKey,
      successorContainerKeyEpochId: fixture.currentKeyEpochId,
    }),
  ).rejects.toThrow("reuses key material");
});

test("epoch bounds are enforced at seal time", async () => {
  const fixture = await keyringFixture(2);

  await expect(
    sealContainerKekKeyring({
      containerId: fixture.containerId,
      entries: [],
      keyEpoch: 1,
      successorContainerKey: fixture.currentKey,
      successorContainerKeyEpochId: fixture.currentKeyEpochId,
    }),
  ).rejects.toThrow("[2, MAX_CONTAINER_KEY_EPOCH]");
  expect(() =>
    expectedSealedContainerKekKeyringBytes(MAX_CONTAINER_KEY_EPOCH + 1),
  ).toThrow("[2, MAX_CONTAINER_KEY_EPOCH]");
});

test("normalization pins suite, version, and canonical base64", async () => {
  const fixture = await keyringFixture(3);
  const keyring = await sealFixture(fixture);

  expect(normalizeContainerKekKeyring(keyring)).toEqual(keyring);
  expect(() =>
    normalizeContainerKekKeyring({ ...keyring, version: 2 }),
  ).toThrow("version is unsupported");
  expect(() =>
    normalizeContainerKekKeyring({ ...keyring, sealingSuite: "aes-kw" }),
  ).toThrow("sealing suite is unsupported");
  expect(() =>
    normalizeContainerKekKeyring({ ...keyring, iv: "@@not-base64@@" }),
  ).toThrow("must be base64");
  expect(() =>
    normalizeContainerKekKeyring({ ...keyring, extra: true }),
  ).toThrow();
});

test("the keyring hash commits to every field", async () => {
  const fixture = await keyringFixture(3);
  const keyring = await sealFixture(fixture);
  const hash = await computeContainerKekKeyringHash(keyring);

  expect(await computeContainerKekKeyringHash({ ...keyring })).toBe(hash);
  const other = await sealFixture(fixture);
  // A fresh seal uses a fresh IV, so the hash must differ.
  expect(await computeContainerKekKeyringHash(other)).not.toBe(hash);
});

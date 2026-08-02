import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  SEALED_CONTAINER_KEK_KEYRING_AEAD_OVERHEAD_BYTES,
  SEALED_CONTAINER_KEK_KEYRING_ENTRY_BYTES,
  SEALED_CONTAINER_KEK_KEYRING_HEADER_BYTES,
  sealedContainerKekKeyringBytes,
} from "@tearleads/validators/util";
import { bytesToHex, hexToBytes } from "../hex";
import {
  AES_GCM_TAG_BYTES,
  assertAesGcmIv,
  decryptWithDek,
  encryptWithDek,
} from "../symmetric";
import {
  computeKeyingDomainHash,
  serializeKeyingCanonicalJson,
} from "./canonical";
import {
  computeContainerKekMaterialId,
  isContainerKekMaterialId,
} from "./containerKekMaterial";
import {
  assertExactKeys,
  readPositiveInteger,
  readString,
  throwVerification,
} from "./shared";
import {
  CONTAINER_KEK_KEYRING_SEAL_SUITE,
  CONTAINER_KEK_MATERIAL_ID_PREFIX,
  type ContainerKekKeyring,
  type ContainerKekKeyringEntry,
  MAX_CONTAINER_KEY_EPOCH,
} from "./types";

const TEXT_ENCODER = new TextEncoder();

/**
 * Sealed-keyring plaintext layout, fixed width by construction:
 * an 8-byte header (u32 BE format version, u32 BE entry count) followed by one
 * 64-byte record per predecessor epoch in ascending epoch order (32-byte
 * material-id hash, 32-byte key material). Entry ordinal i therefore IS key
 * epoch i + 1, and the sealed byte length for key epoch n is an equality,
 * never a bound. The arithmetic lives in @tearleads/validators so request
 * and response guards share it.
 */
export const CONTAINER_KEK_KEYRING_FORMAT_VERSION = 1;
export const CONTAINER_KEK_KEYRING_HEADER_BYTES =
  SEALED_CONTAINER_KEK_KEYRING_HEADER_BYTES;
export const CONTAINER_KEK_KEYRING_ENTRY_BYTES =
  SEALED_CONTAINER_KEK_KEYRING_ENTRY_BYTES;

if (SEALED_CONTAINER_KEK_KEYRING_AEAD_OVERHEAD_BYTES !== AES_GCM_TAG_BYTES) {
  throw new Error(
    "Container KEK keyring wire overhead does not match the AES-GCM tag size",
  );
}

export function expectedSealedContainerKekKeyringBytes(
  keyEpoch: number,
): number {
  assertKeyringKeyEpoch(keyEpoch);
  return sealedContainerKekKeyringBytes(keyEpoch);
}

function assertKeyringKeyEpoch(keyEpoch: number): void {
  if (
    !Number.isInteger(keyEpoch) ||
    keyEpoch < 2 ||
    keyEpoch > MAX_CONTAINER_KEY_EPOCH
  ) {
    throwVerification(
      "invalid_shape",
      "container KEK keyring key epoch must be an integer in [2, MAX_CONTAINER_KEY_EPOCH]",
    );
  }
}

function keyringAdditionalData(input: {
  containerId: string;
  containerKeyEpochId: string;
}): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      domain: "tearleads.container-kek-keyring.aad",
      payload: {
        version: 1,
        sealingSuite: CONTAINER_KEK_KEYRING_SEAL_SUITE,
        containerId: input.containerId,
        containerKeyEpochId: input.containerKeyEpochId,
      },
    }),
  );
}

function canonicalBase64(value: string, label: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(value);
  } catch {
    throwVerification("invalid_shape", `${label} must be base64`);
  }
  if (bytesToBase64(bytes) !== value) {
    throwVerification("invalid_shape", `${label} must use canonical base64`);
  }
  return bytes;
}

function materialIdHashBytes(
  containerKeyEpochId: string,
  label: string,
): Uint8Array {
  if (!isContainerKekMaterialId(containerKeyEpochId)) {
    throwVerification(
      "invalid_shape",
      `${label} must commit to key material`,
    );
  }
  return hexToBytes(
    containerKeyEpochId.slice(CONTAINER_KEK_MATERIAL_ID_PREFIX.length),
  );
}

function materialIdFromHashBytes(hashBytes: Uint8Array): string {
  return `${CONTAINER_KEK_MATERIAL_ID_PREFIX}${bytesToHex(hashBytes)}`;
}

export function normalizeContainerKekKeyring(
  value: unknown,
): ContainerKekKeyring {
  const record = assertExactKeys(
    value,
    [
      "containerId",
      "containerKeyEpochId",
      "iv",
      "sealed",
      "sealingSuite",
      "version",
    ],
    "container KEK keyring",
  );
  const version = readPositiveInteger(
    record,
    "version",
    "container KEK keyring",
  );
  if (version !== 1) {
    throwVerification(
      "invalid_shape",
      "container KEK keyring version is unsupported",
    );
  }
  const sealingSuite = readString(
    record,
    "sealingSuite",
    "container KEK keyring",
  );
  if (sealingSuite !== CONTAINER_KEK_KEYRING_SEAL_SUITE) {
    throwVerification(
      "invalid_shape",
      "container KEK keyring sealing suite is unsupported",
    );
  }
  const keyring: ContainerKekKeyring = {
    version: 1,
    sealingSuite: CONTAINER_KEK_KEYRING_SEAL_SUITE,
    containerId: readString(record, "containerId", "container KEK keyring"),
    containerKeyEpochId: readString(
      record,
      "containerKeyEpochId",
      "container KEK keyring",
    ),
    iv: readString(record, "iv", "container KEK keyring"),
    sealed: readString(record, "sealed", "container KEK keyring"),
  };
  if (keyring.containerId.length === 0) {
    throwVerification(
      "invalid_shape",
      "container KEK keyring container id must not be empty",
    );
  }
  if (!isContainerKekMaterialId(keyring.containerKeyEpochId)) {
    throwVerification(
      "invalid_shape",
      "container KEK keyring sealing epoch id must commit to key material",
    );
  }
  const iv = canonicalBase64(keyring.iv, "container KEK keyring.iv");
  assertAesGcmIv(iv, "Container KEK keyring IV must be 12 bytes");
  const sealed = canonicalBase64(keyring.sealed, "container KEK keyring.sealed");
  const bodyBytes =
    sealed.byteLength - CONTAINER_KEK_KEYRING_HEADER_BYTES - AES_GCM_TAG_BYTES;
  if (
    bodyBytes < CONTAINER_KEK_KEYRING_ENTRY_BYTES ||
    bodyBytes % CONTAINER_KEK_KEYRING_ENTRY_BYTES !== 0 ||
    bodyBytes / CONTAINER_KEK_KEYRING_ENTRY_BYTES > MAX_CONTAINER_KEY_EPOCH - 1
  ) {
    throwVerification(
      "invalid_shape",
      "container KEK keyring sealed length is not a whole entry count",
    );
  }
  return keyring;
}

/** Enforces the exact-length equality for a keyring sealed at `keyEpoch`. */
export function assertSealedContainerKekKeyringLength(
  keyring: ContainerKekKeyring,
  keyEpoch: number,
): void {
  const sealed = base64ToBytes(keyring.sealed);
  if (sealed.byteLength !== expectedSealedContainerKekKeyringBytes(keyEpoch)) {
    throwVerification(
      "invalid_shape",
      "container KEK keyring sealed length does not match its key epoch",
    );
  }
}

export async function computeContainerKekKeyringHash(
  value: unknown,
): Promise<string> {
  const keyring = normalizeContainerKekKeyring(value);
  return computeKeyingDomainHash("tearleads.keying.container-kek-keyring", {
    version: keyring.version,
    sealingSuite: keyring.sealingSuite,
    containerId: keyring.containerId,
    containerKeyEpochId: keyring.containerKeyEpochId,
    iv: keyring.iv,
    sealed: keyring.sealed,
  });
}

function encodeKeyringEntries(
  entries: readonly ContainerKekKeyringEntry[],
): Uint8Array {
  const plaintext = new Uint8Array(
    CONTAINER_KEK_KEYRING_HEADER_BYTES +
      entries.length * CONTAINER_KEK_KEYRING_ENTRY_BYTES,
  );
  const view = new DataView(plaintext.buffer);
  view.setUint32(0, CONTAINER_KEK_KEYRING_FORMAT_VERSION);
  view.setUint32(4, entries.length);
  for (const [index, entry] of entries.entries()) {
    const offset =
      CONTAINER_KEK_KEYRING_HEADER_BYTES +
      index * CONTAINER_KEK_KEYRING_ENTRY_BYTES;
    plaintext.set(
      materialIdHashBytes(
        entry.containerKeyEpochId,
        `container KEK keyring entry ${index} epoch id`,
      ),
      offset,
    );
    plaintext.set(entry.keyMaterial, offset + 32);
  }
  return plaintext;
}

function assertSealableEntries(input: {
  entries: readonly ContainerKekKeyringEntry[];
  keyEpoch: number;
  successorContainerKey: Uint8Array;
  successorContainerKeyEpochId: string;
}): void {
  assertKeyringKeyEpoch(input.keyEpoch);
  if (input.entries.length !== input.keyEpoch - 1) {
    throwVerification(
      "invalid_shape",
      "container KEK keyring must contain exactly one entry per predecessor epoch",
    );
  }
  if (input.successorContainerKey.byteLength !== 32) {
    throwVerification(
      "invalid_shape",
      "container KEK keyring sealing key must be 32 bytes",
    );
  }
  const seenMaterial = new Set([bytesToHex(input.successorContainerKey)]);
  const seenEpochIds = new Set([input.successorContainerKeyEpochId]);
  for (const [index, entry] of input.entries.entries()) {
    if (entry.keyMaterial.byteLength !== 32) {
      throwVerification(
        "invalid_shape",
        `container KEK keyring entry ${index} key material must be 32 bytes`,
      );
    }
    const materialHex = bytesToHex(entry.keyMaterial);
    if (
      seenMaterial.has(materialHex) ||
      seenEpochIds.has(entry.containerKeyEpochId)
    ) {
      throwVerification(
        "key_epoch_reuse",
        `container KEK keyring entry ${index} reuses key material`,
      );
    }
    seenMaterial.add(materialHex);
    seenEpochIds.add(entry.containerKeyEpochId);
  }
}

export async function sealContainerKekKeyring(input: {
  containerId: string;
  entries: readonly ContainerKekKeyringEntry[];
  keyEpoch: number;
  successorContainerKey: Uint8Array;
  successorContainerKeyEpochId: string;
}): Promise<ContainerKekKeyring> {
  assertSealableEntries(input);
  const metadata = {
    containerId: input.containerId,
    containerKeyEpochId: input.successorContainerKeyEpochId,
  };
  const encrypted = await encryptWithDek(
    encodeKeyringEntries(input.entries),
    input.successorContainerKey,
    keyringAdditionalData(metadata),
  );
  const keyring: ContainerKekKeyring = {
    version: 1,
    sealingSuite: CONTAINER_KEK_KEYRING_SEAL_SUITE,
    containerId: input.containerId,
    containerKeyEpochId: input.successorContainerKeyEpochId,
    iv: bytesToBase64(encrypted.iv),
    sealed: bytesToBase64(encrypted.ciphertext),
  };
  assertSealedContainerKekKeyringLength(keyring, input.keyEpoch);
  const reopened = await openContainerKekKeyring({
    keyEpoch: input.keyEpoch,
    keyring,
    successorContainerKey: input.successorContainerKey,
  });
  for (const [index, entry] of reopened.entries()) {
    const sealedEntry = input.entries[index];
    if (
      !sealedEntry ||
      entry.containerKeyEpochId !== sealedEntry.containerKeyEpochId
    ) {
      throwVerification(
        "hash_mismatch",
        "container KEK keyring failed local round-trip verification",
      );
    }
  }
  return keyring;
}

export async function openContainerKekKeyring(input: {
  keyEpoch: number;
  keyring: ContainerKekKeyring;
  successorContainerKey: Uint8Array;
}): Promise<ContainerKekKeyringEntry[]> {
  const keyring = normalizeContainerKekKeyring(input.keyring);
  assertSealedContainerKekKeyringLength(keyring, input.keyEpoch);
  const plaintext = await decryptWithDek(
    {
      iv: base64ToBytes(keyring.iv),
      ciphertext: base64ToBytes(keyring.sealed),
    },
    input.successorContainerKey,
    keyringAdditionalData(keyring),
  );
  const view = new DataView(
    plaintext.buffer,
    plaintext.byteOffset,
    plaintext.byteLength,
  );
  if (view.getUint32(0) !== CONTAINER_KEK_KEYRING_FORMAT_VERSION) {
    throwVerification(
      "invalid_shape",
      "container KEK keyring format version is unsupported",
    );
  }
  const entryCount = view.getUint32(4);
  if (entryCount !== input.keyEpoch - 1) {
    throwVerification(
      "invalid_shape",
      "container KEK keyring entry count does not match its key epoch",
    );
  }
  const entries: ContainerKekKeyringEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    const offset =
      CONTAINER_KEK_KEYRING_HEADER_BYTES +
      index * CONTAINER_KEK_KEYRING_ENTRY_BYTES;
    entries.push({
      containerKeyEpochId: materialIdFromHashBytes(
        plaintext.subarray(offset, offset + 32),
      ),
      keyMaterial: plaintext.slice(offset + 32, offset + 64),
    });
  }
  return entries;
}

/**
 * The lazy per-use check: proves a recovered entry is THE key the
 * manifest-anchored epoch id commits to. Entry ordinal i is key epoch i + 1.
 */
export async function verifyContainerKekKeyringEntry(input: {
  containerId: string;
  entry: ContainerKekKeyringEntry;
  keyEpoch: number;
}): Promise<void> {
  const expectedId = await computeContainerKekMaterialId({
    containerId: input.containerId,
    keyEpoch: input.keyEpoch,
    keyMaterial: input.entry.keyMaterial,
  });
  if (expectedId !== input.entry.containerKeyEpochId) {
    throwVerification(
      "hash_mismatch",
      "container KEK keyring entry does not match its committed epoch id",
    );
  }
}

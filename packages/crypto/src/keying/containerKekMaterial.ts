import {
  isSha256HexString,
  MAX_CONTAINER_KEY_EPOCH,
} from "@tearleads/validators/util";
import { computeKeyingDomainHash } from "./canonical";
import { containerKekCacheToken } from "./containerKekCacheToken";
import {
  deriveContainerKekWrappingPublicKey,
  normalizeContainerKekWrappingPublicKey,
} from "./containerKekWrapping";
import { CONTAINER_KEK_MATERIAL_ID_PREFIX } from "./types";

/** Publicly verifiable commitment; KEK holders independently derive the key. */
export async function computeContainerKekPublicCommitment(input: {
  readonly containerId: string;
  readonly keyEpoch: number;
  readonly containerKeyPublicKey: string;
}): Promise<`${typeof CONTAINER_KEK_MATERIAL_ID_PREFIX}${string}`> {
  if (
    !input.containerId ||
    !Number.isSafeInteger(input.keyEpoch) ||
    input.keyEpoch < 1
  ) {
    throw new Error(
      "Container KEK commitment requires an ID and positive epoch",
    );
  }
  const publicKey = normalizeContainerKekWrappingPublicKey(
    input.containerKeyPublicKey,
  );
  if (publicKey === null)
    throw new Error("Container KEK commitment requires a public key");
  const hash = await computeKeyingDomainHash(
    "tearleads.keying.container-kek-public-commitment",
    {
      version: 2,
      containerId: input.containerId,
      keyEpoch: input.keyEpoch,
      publicKey,
    },
  );
  return `${CONTAINER_KEK_MATERIAL_ID_PREFIX}${hash}`;
}

// Compact public commitments survive longer than the much larger public keys.
// Reopened keyrings use fresh byte arrays, so object-identity caching is unsafe.
const materialIds = new Map<
  string,
  `${typeof CONTAINER_KEK_MATERIAL_ID_PREFIX}${string}`
>();
const MAX_CACHED_MATERIAL_IDS = MAX_CONTAINER_KEY_EPOCH;

export async function computeContainerKekMaterialId(input: {
  readonly containerId: string;
  readonly keyEpoch: number;
  readonly keyMaterial: Uint8Array;
}): Promise<`${typeof CONTAINER_KEK_MATERIAL_ID_PREFIX}${string}`> {
  if (
    !input.containerId ||
    !Number.isSafeInteger(input.keyEpoch) ||
    input.keyEpoch < 1 ||
    input.keyMaterial.length !== 32
  ) {
    throw new Error(
      "Container KEK commitment requires an ID, positive epoch, and 32-byte KEK",
    );
  }
  const keyMaterial = input.keyMaterial.slice();
  try {
    const token = await containerKekCacheToken(keyMaterial);
    const cacheKey = JSON.stringify([input.containerId, input.keyEpoch, token]);
    const cached = materialIds.get(cacheKey);
    if (cached) {
      materialIds.delete(cacheKey);
      materialIds.set(cacheKey, cached);
      return cached;
    }
    const result = await computeContainerKekPublicCommitment({
      containerId: input.containerId,
      keyEpoch: input.keyEpoch,
      containerKeyPublicKey: await deriveContainerKekWrappingPublicKey({
        ...input,
        keyMaterial,
      }),
    });
    materialIds.set(cacheKey, result);
    if (materialIds.size > MAX_CACHED_MATERIAL_IDS) {
      const oldest = materialIds.keys().next().value;
      if (oldest !== undefined) materialIds.delete(oldest);
    }
    return result;
  } finally {
    keyMaterial.fill(0);
  }
}

export function isContainerKekMaterialId(value: string): boolean {
  if (!value.startsWith(CONTAINER_KEK_MATERIAL_ID_PREFIX)) {
    return false;
  }

  return isSha256HexString(
    value.slice(CONTAINER_KEK_MATERIAL_ID_PREFIX.length),
  );
}

import { isSha256HexString } from "@tearleads/validators/util";
import { computeKeyingDomainHash } from "./canonical";
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

export async function computeContainerKekMaterialId(input: {
  readonly containerId: string;
  readonly keyEpoch: number;
  readonly keyMaterial: Uint8Array;
}): Promise<`${typeof CONTAINER_KEK_MATERIAL_ID_PREFIX}${string}`> {
  return computeContainerKekPublicCommitment({
    containerId: input.containerId,
    keyEpoch: input.keyEpoch,
    containerKeyPublicKey: await deriveContainerKekWrappingPublicKey(input),
  });
}

export function isContainerKekMaterialId(value: string): boolean {
  if (!value.startsWith(CONTAINER_KEK_MATERIAL_ID_PREFIX)) {
    return false;
  }

  return isSha256HexString(
    value.slice(CONTAINER_KEK_MATERIAL_ID_PREFIX.length),
  );
}

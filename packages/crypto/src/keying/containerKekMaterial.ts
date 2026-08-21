import { bytesToBase64 } from "@symcrypt/encoding";
import { isSha256HexString } from "@symcrypt/validators/util";
import { computeKeyingDomainHash } from "./canonical";
import { CONTAINER_KEK_MATERIAL_ID_PREFIX } from "./types";

export async function computeContainerKekMaterialId(input: {
  readonly containerId: string;
  readonly keyEpoch: number;
  readonly keyMaterial: Uint8Array;
}): Promise<`${typeof CONTAINER_KEK_MATERIAL_ID_PREFIX}${string}`> {
  if (input.keyMaterial.byteLength !== 32) {
    throw new Error("Container KEK material must be 32 bytes");
  }

  const materialHash = await computeKeyingDomainHash(
    "symcrypt.keying.container-kek-material-id",
    {
      version: 1,
      containerId: input.containerId,
      keyEpoch: input.keyEpoch,
      keyMaterial: bytesToBase64(input.keyMaterial),
    },
  );
  return `${CONTAINER_KEK_MATERIAL_ID_PREFIX}${materialHash}`;
}

export function isContainerKekMaterialId(value: string): boolean {
  if (!value.startsWith(CONTAINER_KEK_MATERIAL_ID_PREFIX)) {
    return false;
  }

  return isSha256HexString(
    value.slice(CONTAINER_KEK_MATERIAL_ID_PREFIX.length),
  );
}

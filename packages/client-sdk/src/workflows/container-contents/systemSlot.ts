import { bytesToBase64 } from "@tearleads/encoding";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";

const CONTAINER_SYSTEM_SLOT_PREFIX = "sys_v1_";
const CONTAINER_SYSTEM_SLOT_HMAC_ALGORITHM = {
  hash: "SHA-256",
  name: "HMAC",
} as const;

export interface ContainerSystemSlotDefinition {
  readonly namespace: string;
  readonly projectorId?: string | undefined;
  readonly slotId: string;
  readonly version: number;
}

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function systemSlotDerivationLabel(
  definition: ContainerSystemSlotDefinition,
): string {
  return JSON.stringify({
    namespace: definition.namespace,
    projectorId: definition.projectorId ?? null,
    slotId: definition.slotId,
    version: definition.version,
  });
}

export async function deriveContainerSystemSlot(input: {
  readonly definition: ContainerSystemSlotDefinition;
  readonly secretKey: Uint8Array;
}): Promise<ContainerSystemSlot> {
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    input.secretKey.slice(),
    CONTAINER_SYSTEM_SLOT_HMAC_ALGORITHM,
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    CONTAINER_SYSTEM_SLOT_HMAC_ALGORITHM,
    hmacKey,
    new TextEncoder().encode(systemSlotDerivationLabel(input.definition)),
  );

  return `${CONTAINER_SYSTEM_SLOT_PREFIX}${toBase64Url(
    new Uint8Array(digest),
  )}`;
}

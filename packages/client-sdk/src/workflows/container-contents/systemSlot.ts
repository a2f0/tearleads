import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import { formatContainerSystemSlot } from "../../data/containers/containerSystemSlotFormat";

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

  return formatContainerSystemSlot(new Uint8Array(digest));
}

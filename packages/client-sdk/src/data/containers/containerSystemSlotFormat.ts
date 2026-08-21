import { bytesToBase64 } from "@symcrypt/encoding";
import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";

const CONTAINER_SYSTEM_SLOT_PREFIX = "sys_v1_";

/**
 * Formats a derivation digest as the wire slot value. Every slot derivation
 * (HMAC-keyed container slots, plain-digest organization slots) must go
 * through this one formatter: a drifted prefix or base64url variant would
 * silently split the slot namespace between writers.
 */
export function formatContainerSystemSlot(
  digest: Uint8Array,
): ContainerSystemSlot {
  const encoded = bytesToBase64(digest)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${CONTAINER_SYSTEM_SLOT_PREFIX}${encoded}`;
}

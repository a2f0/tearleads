import { z } from "zod";
import { registerJsonSchemaFragment } from "../jsonSchema";
import { boundedStringSchema, loosePlainObject } from "../schema";

/**
 * Shared wire arithmetic for sealed container KEK keyrings.
 *
 * These numbers define the exact-length equality every layer enforces: the
 * server rejects a rotation whose sealed keyring ciphertext differs from
 * `sealedContainerKekKeyringBytes(keyEpoch)`, and response guards reject any
 * blob over the `MAX_CONTAINER_KEY_EPOCH` ceiling before cryptographic work.
 * `@tearleads/crypto` consumes these same constants for seal/open, so the
 * equation has one definition. The overhead constant is the AES-GCM tag.
 */
export const MAX_CONTAINER_KEY_EPOCH = 65536;
export const SEALED_CONTAINER_KEK_KEYRING_HEADER_BYTES = 8;
export const SEALED_CONTAINER_KEK_KEYRING_ENTRY_BYTES = 64;
export const SEALED_CONTAINER_KEK_KEYRING_AEAD_OVERHEAD_BYTES = 16;

export function sealedContainerKekKeyringBytes(keyEpoch: number): number {
  return (
    SEALED_CONTAINER_KEK_KEYRING_HEADER_BYTES +
    (keyEpoch - 1) * SEALED_CONTAINER_KEK_KEYRING_ENTRY_BYTES +
    SEALED_CONTAINER_KEK_KEYRING_AEAD_OVERHEAD_BYTES
  );
}

function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/** Parse ceiling: the base64 length of a keyring sealed at the epoch cap. */
export const MAX_SEALED_CONTAINER_KEK_KEYRING_BASE64_LENGTH = base64Length(
  sealedContainerKekKeyringBytes(MAX_CONTAINER_KEY_EPOCH),
);

const AES_GCM_IV_BASE64_LENGTH = base64Length(12);
const ContainerKekKeyringVersionSchema = registerJsonSchemaFragment(
  z.custom<number>((value) => value === 1),
  { const: 1, type: "number" },
);

export const ContainerKekKeyringWireRecordSchema = loosePlainObject({
  containerId: z.string(),
  containerKeyEpochId: z.string(),
  iv: boundedStringSchema(AES_GCM_IV_BASE64_LENGTH),
  sealed: boundedStringSchema(MAX_SEALED_CONTAINER_KEK_KEYRING_BASE64_LENGTH),
  sealingSuite: z.string(),
  version: ContainerKekKeyringVersionSchema,
});

/**
 * Structural bound applied before any allocation-heavy or cryptographic work.
 * Content verification (exact length for the epoch, AEAD, per-entry
 * commitments) happens in `@tearleads/crypto`; this guard only bounds a
 * hostile payload.
 */
export function isContainerKekKeyringWireRecord(
  value: unknown,
): value is Record<string, unknown> {
  return ContainerKekKeyringWireRecordSchema.safeParse(value).success;
}

/**
 * Maximum epochs one kek-log page may serve. Recovery walks the log from the
 * newest page backward, so the page bound — not the container's lifetime
 * rotation count — determines a response's size.
 */
export const CONTAINER_KEK_LOG_PAGE_LIMIT = 256;

/**
 * Maximum signed container rekeys one document/blob write may carry inline.
 * Each rotation ships a keyring, which is O(its epoch) bytes, so an unbounded
 * batch is an unbounded request body.
 */
export const MAX_INLINE_CONTAINER_REKEYS = 16;

/**
 * Maximum recipient envelopes one kek-log epoch may serve, applied PER EPOCH
 * so no epoch can be starved by another's width — a starved epoch is
 * indistinguishable from an unaddressed one and would surface as a false
 * `no-addressed-envelope` recovery failure.
 *
 * Recovery needs ONE openable anchor per epoch, not every envelope, and the
 * ranking puts the requester's own direct wrap first, so this cap never costs
 * a usable anchor. Together with the epoch page limit it bounds the response
 * at page x cap rows regardless of how many recipients a container has
 * accumulated.
 */
export const CONTAINER_KEK_WRAPS_PER_EPOCH_LIMIT = 16;

/**
 * Maximum authorized principals a single kek-log read may scope wraps to.
 * A requester's principal set has no intrinsic ceiling and each entry adds a
 * clause, and bind parameters, to the statement.
 *
 * The requester's direct user envelope and their parent-container envelopes
 * are scoped outside this cap and rank ahead of principal wraps, so the bound
 * never costs the anchors openable without principal-policy state. Opening a
 * principal wrap needs that state regardless (see issue #1941).
 */
export const CONTAINER_KEK_LOG_PRINCIPAL_SCOPE_LIMIT = 64;

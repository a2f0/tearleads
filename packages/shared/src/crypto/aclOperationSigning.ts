/**
 * Canonical serialization and Ed25519 signing for VFS ACL operations.
 *
 * Produces a deterministic byte representation of ACL operation fields
 * that can be signed and independently verified by any party with
 * knowledge of the canonical format and the signer's public key.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { base64ToBytes, bytesToBase64 } from '../base64.js';

const TEXT_ENCODER = new TextEncoder();
const CANONICAL_VERSION = 1;

/**
 * Fields included in the canonical serialization, in fixed order.
 * This order MUST NOT change — it defines the signing contract.
 */
interface AclOperationSigningFields {
  opId: string;
  opType: string;
  itemId: string;
  replicaId: string;
  writeId: number;
  occurredAt: string;
  principalType: string;
  principalId: string;
  accessLevel: string;
}

/**
 * Serialize ACL operation fields into a deterministic byte representation.
 *
 * Format: version (1 byte) || length-prefixed UTF-8 fields in fixed order.
 * Each field is encoded as: uint32 big-endian length || UTF-8 bytes.
 * writeId is encoded as its decimal string representation for simplicity
 * and cross-platform compatibility.
 */
export function canonicalizeAclOperation(
  fields: AclOperationSigningFields
): Uint8Array {
  const fieldValues = [
    fields.opId,
    fields.opType,
    fields.itemId,
    fields.replicaId,
    String(fields.writeId),
    fields.occurredAt,
    fields.principalType,
    fields.principalId,
    fields.accessLevel
  ];

  const encodedFields = fieldValues.map((v) => TEXT_ENCODER.encode(v));
  const totalLength =
    1 + encodedFields.reduce((sum, f) => sum + 4 + f.length, 0);
  const buffer = new Uint8Array(totalLength);
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );

  let offset = 0;
  buffer[offset] = CANONICAL_VERSION;
  offset += 1;

  for (const encoded of encodedFields) {
    view.setUint32(offset, encoded.length, false);
    offset += 4;
    buffer.set(encoded, offset);
    offset += encoded.length;
  }

  return buffer;
}

/**
 * Sign an ACL operation using Ed25519.
 *
 * @returns Base64-encoded Ed25519 signature (64 bytes → 88 chars base64)
 */
export function signAclOperation(
  fields: AclOperationSigningFields,
  ed25519PrivateKey: Uint8Array
): string {
  const canonical = canonicalizeAclOperation(fields);
  const signature = ed25519.sign(canonical, ed25519PrivateKey);
  return bytesToBase64(signature);
}

/**
 * Verify an ACL operation signature using Ed25519.
 *
 * @returns true if the signature is valid for the given fields and public key
 */
export function verifyAclOperationSignature(
  fields: AclOperationSigningFields,
  signatureBase64: string,
  ed25519PublicKey: Uint8Array
): boolean {
  const canonical = canonicalizeAclOperation(fields);
  const signature = base64ToBytes(signatureBase64);
  if (!signature) {
    return false;
  }
  try {
    return ed25519.verify(signature, canonical, ed25519PublicKey);
  } catch {
    return false;
  }
}

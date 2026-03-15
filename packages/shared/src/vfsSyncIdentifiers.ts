/**
 * Shared identifier validation for VFS sync protocol.
 *
 * These patterns define the legal format for identifiers exchanged between
 * the sync client and server (e.g. sourceId, actorId, itemId).  Both the
 * client-side transport parser and the server-side compact decoder must
 * agree on the allowed character set — keeping the canonical definition
 * here prevents scaffolding or test fixtures from silently diverging.
 */

export const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

export const OPAQUE_IDENTIFIER_PATTERN = /^[a-z0-9:-]+$/u;

export function isValidSyncIdentifier(value: string): boolean {
  return UUID_PATTERN.test(value) || OPAQUE_IDENTIFIER_PATTERN.test(value);
}

import { Code, ConnectError } from '@connectrpc/connect';
import { bytesToBase64 } from '@tearleads/shared';
import type { VfsCrdtPushOperation } from '@tearleads/shared/gen/tearleads/v2/vfs_pb';
import {
  VfsAclAccessLevel as ProtoVfsAclAccessLevel,
  VfsAclPrincipalType as ProtoVfsAclPrincipalType,
  VfsCrdtOpType as ProtoVfsCrdtOpType,
  VfsCrdtPushStatus as ProtoVfsCrdtPushStatus
} from '@tearleads/shared/gen/tearleads/v2/vfs_pb';

export function encodeIdentifierBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/gu, '');
  if (normalized.length === 32 && /^[0-9a-fA-F]{32}$/u.test(normalized)) {
    const bytes = new Uint8Array(16);
    for (let index = 0; index < 16; index += 1) {
      bytes[index] = Number.parseInt(
        normalized.slice(index * 2, index * 2 + 2),
        16
      );
    }
    return bytes;
  }

  return new TextEncoder().encode(value);
}

function decodeIdentifierBytes(value: Uint8Array): string {
  if (value.length === 16) {
    let hex = '';
    for (const byte of value) {
      hex += byte.toString(16).padStart(2, '0');
    }
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    throw new ConnectError('Invalid identifier encoding', Code.InvalidArgument);
  }
}

export function decodeRequiredIdentifierBytes(
  value: Uint8Array | undefined,
  fieldName: string
): string {
  if (!(value instanceof Uint8Array) || value.length === 0) {
    throw new ConnectError(`${fieldName} is required`, Code.InvalidArgument);
  }

  return decodeIdentifierBytes(value);
}

export function decodeOptionalIdentifierBytes(
  value: Uint8Array | undefined
): string | undefined {
  if (!(value instanceof Uint8Array) || value.length === 0) {
    return undefined;
  }

  return decodeIdentifierBytes(value);
}

export function toDirectOpType(value: ProtoVfsCrdtOpType): string {
  switch (value) {
    case ProtoVfsCrdtOpType.UNSPECIFIED:
      throw new ConnectError('opType is invalid', Code.InvalidArgument);
    case ProtoVfsCrdtOpType.ACL_ADD:
      return 'acl_add';
    case ProtoVfsCrdtOpType.ACL_REMOVE:
      return 'acl_remove';
    case ProtoVfsCrdtOpType.LINK_ADD:
      return 'link_add';
    case ProtoVfsCrdtOpType.LINK_REMOVE:
      return 'link_remove';
    case ProtoVfsCrdtOpType.ITEM_UPSERT:
      return 'item_upsert';
    case ProtoVfsCrdtOpType.ITEM_DELETE:
      return 'item_delete';
    case ProtoVfsCrdtOpType.LINK_REASSIGN:
      return 'link_reassign';
    default:
      throw new ConnectError('opType is invalid', Code.InvalidArgument);
  }
}

export function toProtoOpType(value: string): ProtoVfsCrdtOpType {
  switch (value) {
    case 'acl_add':
      return ProtoVfsCrdtOpType.ACL_ADD;
    case 'acl_remove':
      return ProtoVfsCrdtOpType.ACL_REMOVE;
    case 'link_add':
      return ProtoVfsCrdtOpType.LINK_ADD;
    case 'link_remove':
      return ProtoVfsCrdtOpType.LINK_REMOVE;
    case 'item_upsert':
      return ProtoVfsCrdtOpType.ITEM_UPSERT;
    case 'item_delete':
      return ProtoVfsCrdtOpType.ITEM_DELETE;
    case 'link_reassign':
      return ProtoVfsCrdtOpType.LINK_REASSIGN;
    default:
      throw new ConnectError('Failed to encode opType', Code.Internal);
  }
}

export function toDirectPrincipalType(
  value: ProtoVfsAclPrincipalType
): string | undefined {
  switch (value) {
    case ProtoVfsAclPrincipalType.UNSPECIFIED:
      return undefined;
    case ProtoVfsAclPrincipalType.USER:
      return 'user';
    case ProtoVfsAclPrincipalType.GROUP:
      return 'group';
    case ProtoVfsAclPrincipalType.ORGANIZATION:
      return 'organization';
    default:
      throw new ConnectError('principalType is invalid', Code.InvalidArgument);
  }
}

export function toProtoPrincipalType(
  value: string | null | undefined
): ProtoVfsAclPrincipalType {
  switch (value) {
    case undefined:
    case null:
      return ProtoVfsAclPrincipalType.UNSPECIFIED;
    case 'user':
      return ProtoVfsAclPrincipalType.USER;
    case 'group':
      return ProtoVfsAclPrincipalType.GROUP;
    case 'organization':
      return ProtoVfsAclPrincipalType.ORGANIZATION;
    default:
      throw new ConnectError('Failed to encode principalType', Code.Internal);
  }
}

export function toDirectAccessLevel(
  value: ProtoVfsAclAccessLevel
): string | undefined {
  switch (value) {
    case ProtoVfsAclAccessLevel.UNSPECIFIED:
      return undefined;
    case ProtoVfsAclAccessLevel.READ:
      return 'read';
    case ProtoVfsAclAccessLevel.WRITE:
      return 'write';
    case ProtoVfsAclAccessLevel.ADMIN:
      return 'admin';
    default:
      throw new ConnectError('accessLevel is invalid', Code.InvalidArgument);
  }
}

export function toProtoAccessLevel(
  value: string | null | undefined
): ProtoVfsAclAccessLevel {
  switch (value) {
    case undefined:
    case null:
      return ProtoVfsAclAccessLevel.UNSPECIFIED;
    case 'read':
      return ProtoVfsAclAccessLevel.READ;
    case 'write':
      return ProtoVfsAclAccessLevel.WRITE;
    case 'admin':
      return ProtoVfsAclAccessLevel.ADMIN;
    default:
      throw new ConnectError('Failed to encode accessLevel', Code.Internal);
  }
}

export function toProtoPushStatus(value: string): ProtoVfsCrdtPushStatus {
  switch (value) {
    case 'applied':
      return ProtoVfsCrdtPushStatus.APPLIED;
    case 'staleWriteId':
      return ProtoVfsCrdtPushStatus.STALE_WRITE_ID;
    case 'outdatedOp':
      return ProtoVfsCrdtPushStatus.OUTDATED_OP;
    case 'invalidOp':
      return ProtoVfsCrdtPushStatus.INVALID_OP;
    case 'alreadyApplied':
      return ProtoVfsCrdtPushStatus.ALREADY_APPLIED;
    case 'encryptedEnvelopeUnsupported':
      return ProtoVfsCrdtPushStatus.ENCRYPTED_ENVELOPE_UNSUPPORTED;
    case 'aclDenied':
      return ProtoVfsCrdtPushStatus.ACL_DENIED;
    default:
      throw new ConnectError('Failed to encode push status', Code.Internal);
  }
}

export function toPositiveSafeInteger(
  value: bigint | number,
  fieldName: string
): number {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= Number.MAX_SAFE_INTEGER
  ) {
    return value;
  }

  if (
    typeof value === 'bigint' &&
    value >= 1n &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return Number(value);
  }

  throw new ConnectError(`${fieldName} is invalid`, Code.InvalidArgument);
}

export function toNonNegativeSafeInteger(
  value: bigint | number,
  fieldName: string
): number {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  ) {
    return value;
  }

  if (
    typeof value === 'bigint' &&
    value >= 0n &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return Number(value);
  }

  throw new ConnectError(`${fieldName} is invalid`, Code.InvalidArgument);
}

export function toDirectPushOperation(
  operation: VfsCrdtPushOperation
): Record<string, unknown> {
  const occurredAtMs = toNonNegativeSafeInteger(
    operation.occurredAtMs,
    'occurredAtMs'
  );
  const directOperation: Record<string, unknown> = {
    opId: decodeRequiredIdentifierBytes(operation.opId, 'opId'),
    opType: toDirectOpType(operation.opType),
    itemId: decodeRequiredIdentifierBytes(operation.itemId, 'itemId'),
    replicaId: decodeRequiredIdentifierBytes(operation.replicaId, 'replicaId'),
    writeId: toPositiveSafeInteger(operation.writeId, 'writeId'),
    occurredAt: new Date(occurredAtMs).toISOString()
  };

  const principalType = toDirectPrincipalType(operation.principalType);
  if (principalType) {
    directOperation['principalType'] = principalType;
  }

  const principalId = decodeOptionalIdentifierBytes(operation.principalId);
  if (principalId) {
    directOperation['principalId'] = principalId;
  }

  const accessLevel = toDirectAccessLevel(operation.accessLevel);
  if (accessLevel) {
    directOperation['accessLevel'] = accessLevel;
  }

  const parentId = decodeOptionalIdentifierBytes(operation.parentId);
  if (parentId) {
    directOperation['parentId'] = parentId;
  }

  const childId = decodeOptionalIdentifierBytes(operation.childId);
  if (childId) {
    directOperation['childId'] = childId;
  }

  if (typeof operation.encryptedPayload === 'string') {
    directOperation['encryptedPayload'] = operation.encryptedPayload;
  }
  if (typeof operation.keyEpoch === 'number') {
    directOperation['keyEpoch'] = operation.keyEpoch;
  }
  if (typeof operation.encryptionNonce === 'string') {
    directOperation['encryptionNonce'] = operation.encryptionNonce;
  }
  if (typeof operation.encryptionAad === 'string') {
    directOperation['encryptionAad'] = operation.encryptionAad;
  }
  if (typeof operation.encryptionSignature === 'string') {
    directOperation['encryptionSignature'] = operation.encryptionSignature;
  }

  if (
    operation.operationSignature instanceof Uint8Array &&
    operation.operationSignature.length > 0
  ) {
    directOperation['operationSignature'] = bytesToBase64(
      operation.operationSignature
    );
  }

  return directOperation;
}

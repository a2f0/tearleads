import type { VfsAclAccessLevel, VfsAclPrincipalType } from '@tearleads/shared';

export type VfsCrdtOpType =
  | 'acl_add'
  | 'acl_remove'
  | 'link_add'
  | 'link_remove';

export interface VfsCrdtOperation {
  opId: string;
  opType: VfsCrdtOpType;
  itemId: string;
  replicaId: string;
  writeId: number;
  occurredAt: string;
  principalType?: VfsAclPrincipalType;
  principalId?: string;
  accessLevel?: VfsAclAccessLevel;
  parentId?: string;
  childId?: string;
  /** Encrypted operation payload (base64-encoded ciphertext) */
  encryptedPayload?: string;
  /** Key epoch used for encryption */
  keyEpoch?: number;
  /** Encryption nonce (base64-encoded) */
  encryptionNonce?: string;
  /** Additional authenticated data hash (base64-encoded) */
  encryptionAad?: string;
  /** Operation signature for integrity verification (base64-encoded) */
  encryptionSignature?: string;
}

export type VfsCrdtApplyStatus =
  | 'applied'
  | 'staleWriteId'
  | 'outdatedOp'
  | 'invalidOp';

export interface VfsCrdtApplyResult {
  opId: string;
  status: VfsCrdtApplyStatus;
}

export interface VfsCrdtAclEntry {
  itemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
  accessLevel: VfsAclAccessLevel;
}

export interface VfsCrdtLinkEntry {
  parentId: string;
  childId: string;
}

export interface VfsCrdtSnapshot {
  acl: VfsCrdtAclEntry[];
  links: VfsCrdtLinkEntry[];
  lastReconciledWriteIds: Record<string, number>;
}

export type VfsCrdtOrderViolationCode =
  | 'invalidOperation'
  | 'duplicateOpId'
  | 'outOfOrderFeed'
  | 'nonMonotonicReplicaWriteId';

export class VfsCrdtOrderViolationError extends Error {
  readonly code: VfsCrdtOrderViolationCode;
  readonly operationIndex: number;

  constructor(
    code: VfsCrdtOrderViolationCode,
    operationIndex: number,
    message: string
  ) {
    super(message);
    this.name = 'VfsCrdtOrderViolationError';
    this.code = code;
    this.operationIndex = operationIndex;
  }
}

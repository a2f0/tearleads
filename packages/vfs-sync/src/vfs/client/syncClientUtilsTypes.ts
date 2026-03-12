import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtSyncItem,
  VfsSyncBloomFilter
} from '@tearleads/shared';
import type { VfsContainerClockEntry } from '../protocol/sync-container-clocks.js';
import type { VfsCrdtOperation, VfsCrdtOpType } from '../protocol/sync-crdt.js';
import type { VfsCrdtFeedReplaySnapshot } from '../protocol/sync-crdt-feed-replay.js';
import type {
  VfsCrdtClientReconcileState,
  VfsCrdtLastReconciledWriteIds
} from '../protocol/sync-crdt-reconcile.js';
import type { VfsSyncCursor } from '../protocol/sync-cursor.js';

export const DEFAULT_PULL_LIMIT = 100;
export const MAX_PULL_LIMIT = 500;
export const MAX_CLIENT_ID_LENGTH = 128;
export const DEFAULT_REMATERIALIZATION_ATTEMPTS = 1;
export const MAX_STALE_PUSH_RECOVERY_ATTEMPTS = 2;

export const VALID_ACCESS_LEVELS: VfsAclAccessLevel[] = [
  'read',
  'write',
  'admin'
];
export const VALID_PRINCIPAL_TYPES: VfsAclPrincipalType[] = [
  'user',
  'group',
  'organization'
];
export const VALID_OP_TYPES: VfsCrdtOpType[] = [
  'acl_add',
  'acl_remove',
  'link_add',
  'link_remove',
  'item_upsert',
  'item_delete'
];

export interface VfsCrdtSyncPullResponse {
  items: VfsCrdtSyncItem[];
  hasMore: boolean;
  nextCursor: VfsSyncCursor | null;
  lastReconciledWriteIds: VfsCrdtLastReconciledWriteIds;
  bloomFilter?: VfsSyncBloomFilter | null;
}

export type VfsCrdtSyncPushStatus =
  | 'applied'
  | 'alreadyApplied'
  | 'staleWriteId'
  | 'outdatedOp'
  | 'invalidOp'
  | 'encryptedEnvelopeUnsupported';

export interface VfsCrdtSyncPushResult {
  opId: string;
  status: VfsCrdtSyncPushStatus;
}

export interface VfsCrdtSyncPushResponse {
  results: VfsCrdtSyncPushResult[];
}

export interface VfsCrdtSyncReconcileResponse {
  cursor: VfsSyncCursor;
  lastReconciledWriteIds: VfsCrdtLastReconciledWriteIds;
}

export interface VfsCrdtSyncSessionResponse {
  push: VfsCrdtSyncPushResponse;
  pull: VfsCrdtSyncPullResponse;
  reconcile: VfsCrdtSyncReconcileResponse;
}

export type VfsSyncGuardrailViolationCode =
  | 'staleWriteRecoveryExhausted'
  | 'pullPageInvariantViolation'
  | 'pullDuplicateOpReplay'
  | 'pullCursorRegression'
  | 'pullRematerializationRequired'
  | 'reconcileCursorRegression'
  | 'lastWriteIdRegression'
  | 'hydrateGuardrailViolation';

export interface VfsSyncGuardrailViolation {
  code: VfsSyncGuardrailViolationCode;
  stage: 'flush' | 'pull' | 'reconcile' | 'hydrate';
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface VfsCrdtSyncTransport {
  pushOperations(input: {
    userId: string;
    clientId: string;
    operations: VfsCrdtOperation[];
  }): Promise<VfsCrdtSyncPushResponse>;
  pullOperations(input: {
    userId: string;
    clientId: string;
    cursor: VfsSyncCursor | null;
    limit: number;
    bloomFilter?: VfsSyncBloomFilter | null;
  }): Promise<VfsCrdtSyncPullResponse>;
  reconcileState?(input: {
    userId: string;
    clientId: string;
    cursor: VfsSyncCursor;
    lastReconciledWriteIds: VfsCrdtLastReconciledWriteIds;
  }): Promise<VfsCrdtSyncReconcileResponse>;
  syncSession?(input: {
    userId: string;
    clientId: string;
    cursor: VfsSyncCursor;
    limit: number;
    operations: VfsCrdtOperation[];
    lastReconciledWriteIds: VfsCrdtLastReconciledWriteIds;
    rootId?: string | null;
    bloomFilter?: VfsSyncBloomFilter | null;
  }): Promise<VfsCrdtSyncSessionResponse>;
}

export interface QueueVfsCrdtLocalOperationInput {
  opType: VfsCrdtOpType;
  itemId: string;
  principalType?: VfsAclPrincipalType;
  principalId?: string;
  accessLevel?: VfsAclAccessLevel;
  parentId?: string;
  childId?: string;
  occurredAt?: string;
  opId?: string;
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

export interface VfsBackgroundSyncClientOptions {
  pullLimit?: number;
  now?: () => Date;
  onBackgroundError?: (error: unknown) => void;
  onGuardrailViolation?: (violation: VfsSyncGuardrailViolation) => void;
  maxRematerializationAttempts?: number;
  onRematerializationRequired?: VfsRematerializationRequiredHandler;
}

export interface VfsBackgroundSyncClientFlushResult {
  pushedOperations: number;
  pulledOperations: number;
  pullPages: number;
}

export interface VfsBackgroundSyncClientSyncResult {
  pulledOperations: number;
  pullPages: number;
}

export interface VfsBackgroundSyncClientSnapshot {
  acl: Array<{
    itemId: string;
    principalType: VfsAclPrincipalType;
    principalId: string;
    accessLevel: VfsAclAccessLevel;
  }>;
  links: Array<{
    parentId: string;
    childId: string;
  }>;
  cursor: VfsSyncCursor | null;
  lastReconciledWriteIds: VfsCrdtLastReconciledWriteIds;
  containerClocks: VfsContainerClockEntry[];
  pendingOperations: number;
  nextLocalWriteId: number;
}

export interface VfsBackgroundSyncClientPersistedState {
  replaySnapshot: VfsCrdtFeedReplaySnapshot;
  reconcileState: VfsCrdtClientReconcileState | null;
  containerClocks: VfsContainerClockEntry[];
  pendingOperations: VfsCrdtOperation[];
  nextLocalWriteId: number;
}

export interface VfsBackgroundSyncClientRematerializedState {
  replaySnapshot: VfsCrdtFeedReplaySnapshot;
  reconcileState: VfsCrdtClientReconcileState | null;
  containerClocks: VfsContainerClockEntry[];
}

export type VfsRematerializationRequiredHandler = (input: {
  userId: string;
  clientId: string;
  error: VfsCrdtRematerializationRequiredError;
  attempt: number;
}) =>
  | Promise<VfsBackgroundSyncClientRematerializedState | null | undefined>
  | VfsBackgroundSyncClientRematerializedState
  | null
  | undefined;

export class VfsCrdtSyncPushRejectedError extends Error {
  constructor(results: VfsCrdtSyncPushResult[]) {
    super('push rejected one or more operations');
    this.name = 'VfsCrdtSyncPushRejectedError';
    Object.defineProperty(this, 'rejectedResults', {
      value: results,
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
}

export class VfsCrdtRematerializationRequiredError extends Error {
  readonly code: 'crdt_rematerialization_required';
  readonly requestedCursor: string | null;
  readonly oldestAvailableCursor: string | null;

  constructor(input?: {
    message?: string;
    requestedCursor?: string | null;
    oldestAvailableCursor?: string | null;
  }) {
    super(
      input?.message ??
        'CRDT cursor is older than retained history; re-materialization required'
    );
    this.name = 'VfsCrdtRematerializationRequiredError';
    this.code = 'crdt_rematerialization_required';
    this.requestedCursor = input?.requestedCursor ?? null;
    this.oldestAvailableCursor = input?.oldestAvailableCursor ?? null;
  }
}

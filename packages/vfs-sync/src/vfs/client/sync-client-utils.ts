import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtSyncItem
} from '@tearleads/shared';
import type { VfsContainerClockEntry } from '../protocol/sync-container-clocks.js';
import type { VfsCrdtOperation, VfsCrdtOpType } from '../protocol/sync-crdt.js';
import type { VfsCrdtFeedReplaySnapshot } from '../protocol/sync-crdt-feed-replay.js';
import type {
  VfsCrdtClientReconcileState,
  VfsCrdtLastReconciledWriteIds
} from '../protocol/sync-crdt-reconcile.js';
import type { VfsSyncCursor } from '../protocol/sync-cursor.js';

const DEFAULT_PULL_LIMIT = 100;
const MAX_PULL_LIMIT = 500;
const MAX_CLIENT_ID_LENGTH = 128;
const DEFAULT_REMATERIALIZATION_ATTEMPTS = 1;
export const MAX_STALE_PUSH_RECOVERY_ATTEMPTS = 2;

const VALID_ACCESS_LEVELS: VfsAclAccessLevel[] = ['read', 'write', 'admin'];
const VALID_PRINCIPAL_TYPES: VfsAclPrincipalType[] = [
  'user',
  'group',
  'organization'
];
const VALID_OP_TYPES: VfsCrdtOpType[] = [
  'acl_add',
  'acl_remove',
  'link_add',
  'link_remove',
  'item_upsert',
  'item_delete'
];

export function isAccessLevel(value: unknown): value is VfsAclAccessLevel {
  return (
    typeof value === 'string' &&
    VALID_ACCESS_LEVELS.some((candidate) => candidate === value)
  );
}

export function isPrincipalType(value: unknown): value is VfsAclPrincipalType {
  return (
    typeof value === 'string' &&
    VALID_PRINCIPAL_TYPES.some((candidate) => candidate === value)
  );
}

export function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeOccurredAt(value: unknown): string | null {
  const normalized = normalizeRequiredString(value);
  if (!normalized) {
    return null;
  }

  const parsedMs = Date.parse(normalized);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

function sleep(ms: number): Promise<void> {
  if (ms < 1) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function parsePullLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_PULL_LIMIT;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(
      `pullLimit must be an integer between 1 and ${MAX_PULL_LIMIT}`
    );
  }

  if (value < 1 || value > MAX_PULL_LIMIT) {
    throw new Error(
      `pullLimit must be an integer between 1 and ${MAX_PULL_LIMIT}`
    );
  }

  return value;
}

export function validateClientId(value: string): void {
  if (value.length === 0 || value.length > MAX_CLIENT_ID_LENGTH) {
    throw new Error('clientId must be non-empty and at most 128 characters');
  }

  if (value.includes(':')) {
    throw new Error('clientId must not include ":"');
  }
}

export function parsePositiveSafeInteger(
  value: unknown,
  fieldName: string
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(`${fieldName} must be a positive safe integer`);
  }

  return value;
}

export function cloneCursor(cursor: VfsSyncCursor): VfsSyncCursor {
  return {
    changedAt: cursor.changedAt,
    changeId: cursor.changeId
  };
}

function toCursorFromItem(item: VfsCrdtSyncItem): VfsSyncCursor {
  const occurredAtMs = Date.parse(item.occurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    throw new Error('transport returned item with invalid occurredAt');
  }

  const changeId = normalizeRequiredString(item.opId);
  if (!changeId) {
    throw new Error('transport returned item with missing opId');
  }

  return {
    changedAt: new Date(occurredAtMs).toISOString(),
    changeId
  };
}

export function lastItemCursor(items: VfsCrdtSyncItem[]): VfsSyncCursor | null {
  if (items.length === 0) {
    return null;
  }

  const lastItem = items[items.length - 1];
  if (!lastItem) {
    return null;
  }

  return toCursorFromItem(lastItem);
}

function isPushStatus(value: unknown): value is VfsCrdtSyncPushStatus {
  return (
    value === 'applied' ||
    value === 'alreadyApplied' ||
    value === 'staleWriteId' ||
    value === 'outdatedOp' ||
    value === 'invalidOp' ||
    value === 'encryptedEnvelopeUnsupported'
  );
}

export function isCrdtOpType(value: unknown): value is VfsCrdtOpType {
  return (
    typeof value === 'string' &&
    VALID_OP_TYPES.some((candidate) => candidate === value)
  );
}

export interface VfsCrdtSyncPullResponse {
  items: VfsCrdtSyncItem[];
  hasMore: boolean;
  nextCursor: VfsSyncCursor | null;
  lastReconciledWriteIds: VfsCrdtLastReconciledWriteIds;
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
  }): Promise<VfsCrdtSyncPullResponse>;
  reconcileState?(input: {
    userId: string;
    clientId: string;
    cursor: VfsSyncCursor;
    lastReconciledWriteIds: VfsCrdtLastReconciledWriteIds;
  }): Promise<VfsCrdtSyncReconcileResponse>;
}

export class VfsCrdtSyncPushRejectedError extends Error {
  readonly rejectedResults: VfsCrdtSyncPushResult[];

  constructor(results: VfsCrdtSyncPushResult[]) {
    super('push rejected one or more operations');
    this.name = 'VfsCrdtSyncPushRejectedError';
    this.rejectedResults = results;
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

export function validatePushResponse(
  operations: VfsCrdtOperation[],
  response: VfsCrdtSyncPushResponse
): VfsCrdtSyncPushResult[] {
  if (!Array.isArray(response.results)) {
    throw new Error('transport returned invalid push response');
  }

  if (response.results.length !== operations.length) {
    throw new Error('transport returned mismatched push response size');
  }

  const byOpId = new Map<string, VfsCrdtSyncPushResult>();
  for (const result of response.results) {
    if (
      !result ||
      typeof result.opId !== 'string' ||
      !isPushStatus(result.status)
    ) {
      throw new Error('transport returned invalid push result');
    }

    byOpId.set(result.opId, result);
  }

  const orderedResults: VfsCrdtSyncPushResult[] = [];
  for (const operation of operations) {
    const result = byOpId.get(operation.opId);
    if (!result) {
      throw new Error(
        `transport push response missing result for opId ${operation.opId}`
      );
    }

    orderedResults.push(result);
  }

  return orderedResults;
}

export function assertNonRegressingLastWriteIds(
  observedLastWriteIds: Map<string, number>,
  incomingLastWriteIds: VfsCrdtLastReconciledWriteIds,
  onRegression?:
    | ((input: {
        replicaId: string;
        previousWriteId: number;
        incomingWriteId: number;
      }) => void)
    | null
): void {
  for (const [replicaId, writeId] of Object.entries(incomingLastWriteIds)) {
    const previousWriteId = observedLastWriteIds.get(replicaId) ?? 0;
    if (writeId < previousWriteId) {
      onRegression?.({
        replicaId,
        previousWriteId,
        incomingWriteId: writeId
      });
      throw new Error(
        `transport regressed lastReconciledWriteIds for replica ${replicaId}`
      );
    }

    if (writeId > previousWriteId) {
      observedLastWriteIds.set(replicaId, writeId);
    }
  }
}

export function normalizeCursor(
  cursor: VfsSyncCursor,
  fieldName: string
): VfsSyncCursor {
  const normalizedChangedAt = normalizeOccurredAt(cursor.changedAt);
  const normalizedChangeId = normalizeRequiredString(cursor.changeId);
  if (!normalizedChangedAt || !normalizedChangeId) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return {
    changedAt: normalizedChangedAt,
    changeId: normalizedChangeId
  };
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
  | Promise<VfsBackgroundSyncClientRematerializedState | null | void>
  | VfsBackgroundSyncClientRematerializedState
  | null
  | void;

export interface InMemoryVfsCrdtSyncTransportDelayConfig {
  pushDelayMs?: number;
  pullDelayMs?: number;
}

export async function delayVfsCrdtSyncTransport(
  delays: InMemoryVfsCrdtSyncTransportDelayConfig,
  type: 'push' | 'pull'
): Promise<void> {
  const delayMs = type === 'push' ? delays.pushDelayMs : delays.pullDelayMs;
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs)) {
    return;
  }

  await sleep(delayMs);
}

export function parseRematerializationAttempts(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_REMATERIALIZATION_ATTEMPTS;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('maxRematerializationAttempts must be a non-negative integer');
  }

  if (value < 0) {
    throw new Error('maxRematerializationAttempts must be a non-negative integer');
  }

  return value;
}

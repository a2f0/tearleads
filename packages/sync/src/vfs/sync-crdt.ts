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

interface ParsedStamp {
  replicaId: string;
  writeId: number;
  occurredAt: string;
  occurredAtMs: number;
  opId: string;
}

interface VfsCrdtAclRegister {
  itemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
  accessLevel: VfsAclAccessLevel | null;
  stamp: ParsedStamp;
}

interface VfsCrdtLinkRegister {
  parentId: string;
  childId: string;
  present: boolean;
  stamp: ParsedStamp;
}

type PreparedOperation =
  | {
      kind: 'acl';
      key: string;
      itemId: string;
      principalType: VfsAclPrincipalType;
      principalId: string;
      accessLevel: VfsAclAccessLevel | null;
      stamp: ParsedStamp;
    }
  | {
      kind: 'link';
      key: string;
      parentId: string;
      childId: string;
      present: boolean;
      stamp: ParsedStamp;
    };

const VALID_ACCESS_LEVELS: VfsAclAccessLevel[] = ['read', 'write', 'admin'];
const VALID_PRINCIPAL_TYPES: VfsAclPrincipalType[] = [
  'user',
  'group',
  'organization'
];

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeWriteId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  if (!Number.isInteger(value) || value < 1) {
    return null;
  }

  return value;
}

function normalizeAccessLevel(value: unknown): VfsAclAccessLevel | null {
  if (typeof value !== 'string') {
    return null;
  }

  for (const accessLevel of VALID_ACCESS_LEVELS) {
    if (accessLevel === value) {
      return accessLevel;
    }
  }

  return null;
}

function normalizePrincipalType(value: unknown): VfsAclPrincipalType | null {
  if (typeof value !== 'string') {
    return null;
  }

  for (const principalType of VALID_PRINCIPAL_TYPES) {
    if (principalType === value) {
      return principalType;
    }
  }

  return null;
}

function parseStamp(operation: VfsCrdtOperation): ParsedStamp | null {
  const opId = normalizeNonEmptyString(operation.opId);
  const replicaId = normalizeNonEmptyString(operation.replicaId);
  const writeId = normalizeWriteId(operation.writeId);
  const occurredAt = normalizeNonEmptyString(operation.occurredAt);

  if (!opId || !replicaId || writeId === null || !occurredAt) {
    return null;
  }

  const occurredAtMs = Date.parse(occurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    return null;
  }

  return {
    opId,
    replicaId,
    writeId,
    occurredAt,
    occurredAtMs
  };
}

function compareParsedStamps(left: ParsedStamp, right: ParsedStamp): number {
  if (left.replicaId === right.replicaId) {
    if (left.writeId < right.writeId) {
      return -1;
    }
    if (left.writeId > right.writeId) {
      return 1;
    }
  }

  if (left.occurredAtMs < right.occurredAtMs) {
    return -1;
  }
  if (left.occurredAtMs > right.occurredAtMs) {
    return 1;
  }

  if (left.opId < right.opId) {
    return -1;
  }
  if (left.opId > right.opId) {
    return 1;
  }

  if (left.replicaId < right.replicaId) {
    return -1;
  }
  if (left.replicaId > right.replicaId) {
    return 1;
  }

  if (left.writeId < right.writeId) {
    return -1;
  }
  if (left.writeId > right.writeId) {
    return 1;
  }

  return 0;
}

function compareFeedOrder(left: ParsedStamp, right: ParsedStamp): number {
  if (left.occurredAtMs < right.occurredAtMs) {
    return -1;
  }

  if (left.occurredAtMs > right.occurredAtMs) {
    return 1;
  }

  if (left.opId < right.opId) {
    return -1;
  }

  if (left.opId > right.opId) {
    return 1;
  }

  return 0;
}

function toAclKey(
  itemId: string,
  principalType: VfsAclPrincipalType,
  principalId: string
): string {
  return `${itemId}:${principalType}:${principalId}`;
}

function toLinkKey(parentId: string, childId: string): string {
  return `${parentId}:${childId}`;
}

function prepareOperation(
  operation: VfsCrdtOperation
): PreparedOperation | null {
  const stamp = parseStamp(operation);
  const itemId = normalizeNonEmptyString(operation.itemId);

  if (!stamp || !itemId) {
    return null;
  }

  if (operation.opType === 'acl_add' || operation.opType === 'acl_remove') {
    const principalType = normalizePrincipalType(operation.principalType);
    const principalId = normalizeNonEmptyString(operation.principalId);
    if (!principalType || !principalId) {
      return null;
    }

    if (operation.opType === 'acl_add') {
      const accessLevel = normalizeAccessLevel(operation.accessLevel);
      if (!accessLevel) {
        return null;
      }

      return {
        kind: 'acl',
        key: toAclKey(itemId, principalType, principalId),
        itemId,
        principalType,
        principalId,
        accessLevel,
        stamp
      };
    }

    return {
      kind: 'acl',
      key: toAclKey(itemId, principalType, principalId),
      itemId,
      principalType,
      principalId,
      accessLevel: null,
      stamp
    };
  }

  if (operation.opType === 'link_add' || operation.opType === 'link_remove') {
    const parentId = normalizeNonEmptyString(operation.parentId);
    const childId = normalizeNonEmptyString(operation.childId) ?? itemId;
    if (!parentId || !childId) {
      return null;
    }
    if (childId !== itemId) {
      /**
       * Guardrail: link operations are item-scoped and must not carry a
       * mismatched childId payload for a different item.
       */
      return null;
    }
    if (parentId === childId) {
      /**
       * Guardrail: self-referential links create immediate cycles and are
       * rejected at CRDT normalization so they cannot enter canonical state.
       */
      return null;
    }

    return {
      kind: 'link',
      key: toLinkKey(parentId, childId),
      parentId,
      childId,
      present: operation.opType === 'link_add',
      stamp
    };
  }

  return null;
}

function toSortedLastWriteIds(
  values: Map<string, number>
): Record<string, number> {
  const sortedEntries = Array.from(values.entries()).sort((left, right) =>
    left[0].localeCompare(right[0])
  );

  const result: Record<string, number> = {};
  for (const [replicaId, writeId] of sortedEntries) {
    result[replicaId] = writeId;
  }

  return result;
}

/**
 * Guardrail: canonical CRDT feeds must be strictly ordered by
 * (occurredAt ASC, opId ASC) and each replica's writeId must increase.
 */
export function assertCanonicalVfsCrdtOperationOrder(
  operations: VfsCrdtOperation[]
): void {
  const seenOpIds = new Set<string>();
  const lastReplicaWriteId = new Map<string, number>();
  let previousStamp: ParsedStamp | null = null;

  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index];
    if (!operation) {
      continue;
    }

    const preparedOperation = prepareOperation(operation);
    if (!preparedOperation) {
      throw new VfsCrdtOrderViolationError(
        'invalidOperation',
        index,
        `CRDT operation ${index} is invalid`
      );
    }
    const stamp = preparedOperation.stamp;

    if (seenOpIds.has(stamp.opId)) {
      throw new VfsCrdtOrderViolationError(
        'duplicateOpId',
        index,
        `CRDT operation ${index} repeats opId ${stamp.opId}`
      );
    }
    seenOpIds.add(stamp.opId);

    const previousReplicaWriteId = lastReplicaWriteId.get(stamp.replicaId);
    if (
      previousReplicaWriteId !== undefined &&
      stamp.writeId <= previousReplicaWriteId
    ) {
      throw new VfsCrdtOrderViolationError(
        'nonMonotonicReplicaWriteId',
        index,
        `CRDT operation ${index} has non-monotonic writeId for replica ${stamp.replicaId}`
      );
    }
    lastReplicaWriteId.set(stamp.replicaId, stamp.writeId);

    if (previousStamp && compareFeedOrder(previousStamp, stamp) >= 0) {
      throw new VfsCrdtOrderViolationError(
        'outOfOrderFeed',
        index,
        `CRDT operation ${index} violates feed ordering`
      );
    }

    previousStamp = stamp;
  }
}

export class InMemoryVfsCrdtStateStore {
  private readonly lastReconciledWriteByReplica: Map<string, number> =
    new Map();
  private readonly aclRegisters: Map<string, VfsCrdtAclRegister> = new Map();
  private readonly linkRegisters: Map<string, VfsCrdtLinkRegister> = new Map();

  apply(operation: VfsCrdtOperation): VfsCrdtApplyResult {
    const preparedOperation = prepareOperation(operation);
    if (!preparedOperation) {
      return {
        opId:
          typeof operation.opId === 'string'
            ? operation.opId
            : 'invalid-operation',
        status: 'invalidOp'
      };
    }

    const lastWriteId =
      this.lastReconciledWriteByReplica.get(
        preparedOperation.stamp.replicaId
      ) ?? 0;
    if (preparedOperation.stamp.writeId <= lastWriteId) {
      return {
        opId: preparedOperation.stamp.opId,
        status: 'staleWriteId'
      };
    }

    this.lastReconciledWriteByReplica.set(
      preparedOperation.stamp.replicaId,
      preparedOperation.stamp.writeId
    );

    if (preparedOperation.kind === 'acl') {
      const currentRegister = this.aclRegisters.get(preparedOperation.key);
      if (
        currentRegister &&
        compareParsedStamps(preparedOperation.stamp, currentRegister.stamp) <= 0
      ) {
        return {
          opId: preparedOperation.stamp.opId,
          status: 'outdatedOp'
        };
      }

      this.aclRegisters.set(preparedOperation.key, {
        itemId: preparedOperation.itemId,
        principalType: preparedOperation.principalType,
        principalId: preparedOperation.principalId,
        accessLevel: preparedOperation.accessLevel,
        stamp: preparedOperation.stamp
      });

      return {
        opId: preparedOperation.stamp.opId,
        status: 'applied'
      };
    }

    const currentRegister = this.linkRegisters.get(preparedOperation.key);
    if (
      currentRegister &&
      compareParsedStamps(preparedOperation.stamp, currentRegister.stamp) <= 0
    ) {
      return {
        opId: preparedOperation.stamp.opId,
        status: 'outdatedOp'
      };
    }

    this.linkRegisters.set(preparedOperation.key, {
      parentId: preparedOperation.parentId,
      childId: preparedOperation.childId,
      present: preparedOperation.present,
      stamp: preparedOperation.stamp
    });

    return {
      opId: preparedOperation.stamp.opId,
      status: 'applied'
    };
  }

  applyMany(operations: VfsCrdtOperation[]): VfsCrdtApplyResult[] {
    return operations.map((operation) => this.apply(operation));
  }

  applyManyInCanonicalOrder(
    operations: VfsCrdtOperation[]
  ): VfsCrdtApplyResult[] {
    assertCanonicalVfsCrdtOperationOrder(operations);
    return this.applyMany(operations);
  }

  snapshot(): VfsCrdtSnapshot {
    const acl: VfsCrdtAclEntry[] = [];
    for (const register of this.aclRegisters.values()) {
      if (!register.accessLevel) {
        continue;
      }

      acl.push({
        itemId: register.itemId,
        principalType: register.principalType,
        principalId: register.principalId,
        accessLevel: register.accessLevel
      });
    }

    acl.sort((left, right) => {
      if (left.itemId !== right.itemId) {
        return left.itemId.localeCompare(right.itemId);
      }
      if (left.principalType !== right.principalType) {
        return left.principalType.localeCompare(right.principalType);
      }
      return left.principalId.localeCompare(right.principalId);
    });

    const links: VfsCrdtLinkEntry[] = [];
    for (const register of this.linkRegisters.values()) {
      if (!register.present) {
        continue;
      }

      links.push({
        parentId: register.parentId,
        childId: register.childId
      });
    }

    links.sort((left, right) => {
      if (left.parentId !== right.parentId) {
        return left.parentId.localeCompare(right.parentId);
      }
      return left.childId.localeCompare(right.childId);
    });

    return {
      acl,
      links,
      lastReconciledWriteIds: toSortedLastWriteIds(
        this.lastReconciledWriteByReplica
      )
    };
  }
}

export function reconcileVfsCrdtOperations(
  operations: VfsCrdtOperation[]
): VfsCrdtSnapshot {
  const store = new InMemoryVfsCrdtStateStore();
  store.applyMany(operations);
  return store.snapshot();
}

export function reconcileCanonicalVfsCrdtOperations(
  operations: VfsCrdtOperation[]
): VfsCrdtSnapshot {
  const store = new InMemoryVfsCrdtStateStore();
  store.applyManyInCanonicalOrder(operations);
  return store.snapshot();
}

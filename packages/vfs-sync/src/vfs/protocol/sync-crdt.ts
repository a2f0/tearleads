import type { VfsAclAccessLevel, VfsAclPrincipalType } from '@tearleads/shared';
import {
  compareFeedOrder,
  compareParsedStamps,
  type ParsedStamp,
  prepareOperation
} from './sync-crdt-prepare.js';
import {
  type VfsCrdtAclEntry,
  type VfsCrdtApplyResult,
  type VfsCrdtLinkEntry,
  type VfsCrdtOperation,
  VfsCrdtOrderViolationError,
  type VfsCrdtSnapshot
} from './sync-crdt-types.js';

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

export {
  type VfsCrdtAclEntry,
  type VfsCrdtApplyResult,
  type VfsCrdtApplyStatus,
  type VfsCrdtLinkEntry,
  type VfsCrdtOperation,
  type VfsCrdtOpType,
  type VfsCrdtOrderViolationCode,
  VfsCrdtOrderViolationError,
  type VfsCrdtSnapshot
} from './sync-crdt-types.js';

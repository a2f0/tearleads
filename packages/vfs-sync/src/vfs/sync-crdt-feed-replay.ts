import type { VfsAclAccessLevel, VfsAclPrincipalType } from '@tearleads/shared';
import type { VfsCrdtSyncItem } from './sync-crdt-feed.js';
import type { VfsSyncCursor } from './sync-cursor.js';

interface VfsCrdtFeedAclRegister {
  itemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
  accessLevel: VfsAclAccessLevel | null;
}

interface VfsCrdtFeedLinkRegister {
  parentId: string;
  childId: string;
  present: boolean;
}

export interface VfsCrdtFeedReplaySnapshot {
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
}

export type VfsCrdtFeedReplayViolationCode =
  | 'invalidCursor'
  | 'nonMonotonicCursor'
  | 'invalidAclOperation'
  | 'invalidLinkOperation';

export class VfsCrdtFeedReplayError extends Error {
  readonly code: VfsCrdtFeedReplayViolationCode;
  readonly itemIndex: number;

  constructor(
    code: VfsCrdtFeedReplayViolationCode,
    itemIndex: number,
    message: string
  ) {
    super(message);
    this.name = 'VfsCrdtFeedReplayError';
    this.code = code;
    this.itemIndex = itemIndex;
  }
}

function compareCursor(left: VfsSyncCursor, right: VfsSyncCursor): number {
  const leftMs = Date.parse(left.changedAt);
  const rightMs = Date.parse(right.changedAt);

  if (leftMs < rightMs) {
    return -1;
  }

  if (leftMs > rightMs) {
    return 1;
  }

  if (left.changeId < right.changeId) {
    return -1;
  }

  if (left.changeId > right.changeId) {
    return 1;
  }

  return 0;
}

function toCursor(item: VfsCrdtSyncItem): VfsSyncCursor | null {
  if (typeof item.opId !== 'string' || item.opId.trim().length === 0) {
    return null;
  }

  const parsedOccurredAtMs = Date.parse(item.occurredAt);
  if (!Number.isFinite(parsedOccurredAtMs)) {
    return null;
  }

  return {
    changedAt: new Date(parsedOccurredAtMs).toISOString(),
    changeId: item.opId
  };
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

function isPrincipalType(value: string | null): value is VfsAclPrincipalType {
  return value === 'user' || value === 'group' || value === 'organization';
}

function isAccessLevel(value: string | null): value is VfsAclAccessLevel {
  return value === 'read' || value === 'write' || value === 'admin';
}

function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cloneCursor(cursor: VfsSyncCursor): VfsSyncCursor {
  return {
    changedAt: cursor.changedAt,
    changeId: cursor.changeId
  };
}

function normalizeCursor(cursor: VfsSyncCursor | null): VfsSyncCursor | null {
  if (!cursor) {
    return null;
  }

  const changedAt = normalizeRequiredString(cursor.changedAt);
  const changeId = normalizeRequiredString(cursor.changeId);
  if (!changedAt || !changeId) {
    throw new Error('snapshot cursor is invalid');
  }

  const parsedMs = Date.parse(changedAt);
  if (!Number.isFinite(parsedMs)) {
    throw new Error('snapshot cursor is invalid');
  }

  return {
    changedAt: new Date(parsedMs).toISOString(),
    changeId
  };
}

export class InMemoryVfsCrdtFeedReplayStore {
  private readonly aclRegisters: Map<string, VfsCrdtFeedAclRegister> =
    new Map();
  private readonly linkRegisters: Map<string, VfsCrdtFeedLinkRegister> =
    new Map();
  private cursor: VfsSyncCursor | null = null;

  applyPage(items: VfsCrdtSyncItem[]): VfsSyncCursor | null {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!item) {
        continue;
      }

      const cursor = toCursor(item);
      if (!cursor) {
        throw new VfsCrdtFeedReplayError(
          'invalidCursor',
          index,
          `CRDT feed item ${index} has invalid cursor fields`
        );
      }

      if (this.cursor && compareCursor(cursor, this.cursor) <= 0) {
        throw new VfsCrdtFeedReplayError(
          'nonMonotonicCursor',
          index,
          `CRDT feed item ${index} is not strictly newer than local cursor`
        );
      }

      if (item.opType === 'acl_add' || item.opType === 'acl_remove') {
        this.applyAclItem(item, index);
      } else if (item.opType === 'link_add' || item.opType === 'link_remove') {
        this.applyLinkItem(item, index);
      }

      this.cursor = cursor;
    }

    return this.cursor;
  }

  snapshot(): VfsCrdtFeedReplaySnapshot {
    const acl: VfsCrdtFeedReplaySnapshot['acl'] = [];
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

    const links: VfsCrdtFeedReplaySnapshot['links'] = [];
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
      cursor: this.cursor ? cloneCursor(this.cursor) : null
    };
  }

  replaceSnapshot(snapshot: VfsCrdtFeedReplaySnapshot): void {
    const nextAclRegisters: Map<string, VfsCrdtFeedAclRegister> = new Map();
    const nextLinkRegisters: Map<string, VfsCrdtFeedLinkRegister> = new Map();

    /**
     * Guardrail: snapshot hydration must be deterministic and reject malformed
     * ACL/link identities. Corrupt snapshot input here would permanently poison
     * the local replay state after restart.
     */
    for (const entry of snapshot.acl) {
      const itemId = normalizeRequiredString(entry.itemId);
      const principalType = isPrincipalType(entry.principalType)
        ? entry.principalType
        : null;
      const principalId = normalizeRequiredString(entry.principalId);
      const accessLevel = isAccessLevel(entry.accessLevel)
        ? entry.accessLevel
        : null;
      if (!itemId || !principalType || !principalId || !accessLevel) {
        throw new Error('snapshot acl entry is invalid');
      }

      const key = toAclKey(itemId, principalType, principalId);
      if (nextAclRegisters.has(key)) {
        throw new Error('snapshot acl contains duplicate principal entry');
      }
      nextAclRegisters.set(key, {
        itemId,
        principalType,
        principalId,
        accessLevel
      });
    }

    for (const entry of snapshot.links) {
      const parentId = normalizeRequiredString(entry.parentId);
      const childId = normalizeRequiredString(entry.childId);
      if (!parentId || !childId) {
        throw new Error('snapshot link entry is invalid');
      }

      const key = toLinkKey(parentId, childId);
      if (nextLinkRegisters.has(key)) {
        throw new Error('snapshot links contain duplicate edge');
      }
      nextLinkRegisters.set(key, {
        parentId,
        childId,
        present: true
      });
    }

    this.aclRegisters.clear();
    this.linkRegisters.clear();
    for (const [key, value] of nextAclRegisters) {
      this.aclRegisters.set(key, value);
    }
    for (const [key, value] of nextLinkRegisters) {
      this.linkRegisters.set(key, value);
    }
    this.cursor = normalizeCursor(snapshot.cursor);
  }

  private applyAclItem(item: VfsCrdtSyncItem, index: number): void {
    const principalType = isPrincipalType(item.principalType)
      ? item.principalType
      : null;
    const principalId = normalizeRequiredString(item.principalId);

    if (!principalType || !principalId) {
      throw new VfsCrdtFeedReplayError(
        'invalidAclOperation',
        index,
        `CRDT feed item ${index} is missing principal fields`
      );
    }

    if (item.opType === 'acl_add') {
      if (!isAccessLevel(item.accessLevel)) {
        throw new VfsCrdtFeedReplayError(
          'invalidAclOperation',
          index,
          `CRDT feed item ${index} is missing access level`
        );
      }

      this.aclRegisters.set(toAclKey(item.itemId, principalType, principalId), {
        itemId: item.itemId,
        principalType,
        principalId,
        accessLevel: item.accessLevel
      });
      return;
    }

    this.aclRegisters.set(toAclKey(item.itemId, principalType, principalId), {
      itemId: item.itemId,
      principalType,
      principalId,
      accessLevel: null
    });
  }

  private applyLinkItem(item: VfsCrdtSyncItem, index: number): void {
    const parentId = normalizeRequiredString(item.parentId);
    const childId = normalizeRequiredString(item.childId);

    if (!parentId || !childId) {
      throw new VfsCrdtFeedReplayError(
        'invalidLinkOperation',
        index,
        `CRDT feed item ${index} is missing link fields`
      );
    }

    this.linkRegisters.set(toLinkKey(parentId, childId), {
      parentId,
      childId,
      present: item.opType === 'link_add'
    });
  }
}

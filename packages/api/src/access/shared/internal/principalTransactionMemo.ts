import {
  type DatabaseSession,
  isDatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import type { StoredPrincipalState } from "./principalStateRecords";

/** An organization's immutable group references. */
export interface OrganizationDescriptor {
  readonly adminGroupId: string;
  readonly memberGroupId: string;
  readonly organizationId: string;
}

interface PrincipalTransactionMemo {
  /** Principals whose mutation lock this transaction holds. */
  readonly locked: Set<string>;
  readonly currentStates: Map<string, StoredPrincipalState | null>;
  readonly organizations: Map<string, OrganizationDescriptor>;
  /** Group id to the organization id read with it. */
  readonly groupOrganizations: Map<string, string>;
}

const memos = new WeakMap<DatabaseSession, PrincipalTransactionMemo>();

function principalKey(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
): string {
  return `${principalType}:${principalId}`;
}

function lockedMemo(
  executor: DatabaseSession,
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
): PrincipalTransactionMemo | undefined {
  const memo = memos.get(executor);
  return memo?.locked.has(principalKey(principalType, principalId))
    ? memo
    : undefined;
}

/**
 * Record that this transaction now holds the principal's mutation lock: every
 * writer of a principal's states (and organization purge, for an organization
 * and its groups) takes that lock first, so reads made from here on stay
 * current until this transaction writes them itself. Call only once the lock
 * is granted; on SQLite every API write transaction begins immediate, which
 * already serializes it. The memo is keyed by the transaction object and dies
 * with it; the root executor never records anything.
 */
export function notePrincipalMutationLocked(
  executor: DatabaseSession,
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
): void {
  if (!isDatabaseTransaction(executor)) return;
  let memo = memos.get(executor);
  if (!memo) {
    memo = {
      locked: new Set(),
      currentStates: new Map(),
      organizations: new Map(),
      groupOrganizations: new Map(),
    };
    memos.set(executor, memo);
  }
  memo.locked.add(principalKey(principalType, principalId));
}

/**
 * The current state this transaction read after taking the principal's lock,
 * a copy per caller; `undefined` when it must be read.
 */
export function memoizedCurrentPrincipalState(
  executor: DatabaseSession,
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
): StoredPrincipalState | null | undefined {
  const state = lockedMemo(
    executor,
    principalType,
    principalId,
  )?.currentStates.get(principalKey(principalType, principalId));
  return state === undefined ? undefined : structuredClone(state);
}

/** Keep a current-state read made under the principal's lock. */
export function rememberCurrentPrincipalState(
  executor: DatabaseSession,
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  state: StoredPrincipalState | null,
): void {
  lockedMemo(executor, principalType, principalId)?.currentStates.set(
    principalKey(principalType, principalId),
    state === null ? null : structuredClone(state),
  );
}

/** Call whenever this transaction inserts or deletes principal states. */
export function forgetCurrentPrincipalStates(executor: DatabaseSession): void {
  memos.get(executor)?.currentStates.clear();
}

export function memoizedOrganizationDescriptor(
  executor: DatabaseSession,
  organizationId: string,
): OrganizationDescriptor | undefined {
  return lockedMemo(
    executor,
    "organization",
    organizationId,
  )?.organizations.get(organizationId);
}

export function memoizedGroupOrganizationDescriptor(
  executor: DatabaseSession,
  groupId: string,
): OrganizationDescriptor | undefined {
  const organizationId = memos.get(executor)?.groupOrganizations.get(groupId);
  return organizationId === undefined
    ? undefined
    : memoizedOrganizationDescriptor(executor, organizationId);
}

/**
 * Keep an organization row (and the group it was found through) read under
 * the organization's lock. Its group references never change; only purge,
 * which takes the same lock, deletes the organization's groups.
 */
export function rememberOrganizationDescriptor(
  executor: DatabaseSession,
  descriptor: OrganizationDescriptor,
  groupId?: string,
): void {
  const memo = lockedMemo(executor, "organization", descriptor.organizationId);
  if (!memo) return;
  memo.organizations.set(descriptor.organizationId, descriptor);
  if (groupId !== undefined) {
    memo.groupOrganizations.set(groupId, descriptor.organizationId);
  }
}

/** Call before a transaction deletes organization groups or principal rows. */
export function forgetPrincipalTransactionMemo(
  executor: DatabaseSession,
): void {
  const memo = memos.get(executor);
  if (!memo) return;
  memo.currentStates.clear();
  memo.organizations.clear();
  memo.groupOrganizations.clear();
}

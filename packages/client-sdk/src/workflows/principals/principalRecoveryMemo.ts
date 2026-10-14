import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { principalHeadMatchesReference } from "../../data/principals/organizationAuthorityDescriptor";
import type { RecoveredPrincipalPolicyHistory } from "./principalHistoryRecoveryTypes";
import {
  type PrincipalRecoveryContext,
  type RecoveredPolicyDirectory,
  recoverPolicyDirectory,
} from "./principalRecoveryDirectory";
import {
  adminsMemoValidity,
  directoryMemoValidity,
  type PrincipalRecoveryMemoValidity,
} from "./principalRecoveryMemoValidity";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

interface MemoEntry<T> {
  readonly value: T;
  /** The producing call's private lease and caller lifetime. */
  readonly stillCurrent: () => boolean;
  /** Organization hint epoch observed before the reads that produced value. */
  readonly epoch: number;
}

type Memo<T> = Map<string, Promise<MemoEntry<T>>>;

/** A value handed out with every lifetime it depends on. */
interface Leased<T> {
  readonly value: T;
  /** The consumer's lifetime and every producer lifetime behind value. */
  readonly stillCurrent: () => boolean;
}

export interface PrincipalRecoveryMemo {
  readonly directories: Memo<RecoveredPolicyDirectory>;
  readonly admins: Memo<RecoveredPrincipalPolicyHistory>;
}

/** Synchronous: no hint and no lease end since the entry's reads began. */
function entryLive<T>(
  entry: MemoEntry<T>,
  validity: PrincipalRecoveryMemoValidity<T>,
): boolean {
  return entry.epoch === validity.epoch() && entry.stillCurrent();
}

function evict<T>(
  memo: Memo<T> | undefined,
  key: string,
  pending: Promise<MemoEntry<T>>,
): void {
  if (memo?.get(key) === pending) memo.delete(key);
}

/**
 * Return a live entry, evicting one whose producer lease ended, that predates
 * an organization hint, or that a durable pin has moved past. Liveness is
 * checked again after every await, so a hint or lease end during the pin
 * reads also evicts. The caller rechecks synchronously before use. A pin read
 * is a snapshot; a pin that advances later is caught by the checkpoint reload
 * in recovery, the caller's checkpoint refresh, and atomic admission.
 */
async function reusableEntry<T>(
  memo: Memo<T> | undefined,
  key: string,
  validity: PrincipalRecoveryMemoValidity<T>,
): Promise<
  { entry: MemoEntry<T>; pending: Promise<MemoEntry<T>> } | undefined
> {
  const pending = memo?.get(key);
  if (!pending) return undefined;
  const entry = await pending.catch(() => undefined);
  if (
    entry &&
    entryLive(entry, validity) &&
    (await validity.covers(entry.value)) &&
    entryLive(entry, validity)
  )
    return { entry, pending };
  evict(memo, key, pending);
  return undefined;
}

/**
 * Share authenticated results within one workflow operation. A later caller
 * never receives a result whose producer lease ended, that predates an
 * organization hint, or that a durable pin has moved past; it recovers again.
 * A result derived from a reused source keeps the source's epoch, so a hint
 * that arrives before it is stored still evicts it. Every value is handed out
 * with the consumer's lifetime and its producer's, so a producer that expires
 * after hand-out still invalidates the consumer's use.
 */
async function memoPrincipalRecovery<T>(
  memo: Memo<T> | undefined,
  key: string,
  stillCurrent: () => boolean,
  validity: PrincipalRecoveryMemoValidity<T>,
  sourceEpoch: number | undefined,
  work: () => Promise<T>,
): Promise<Leased<T>> {
  assertProjectionVerificationCurrent(stillCurrent);
  const reused = await reusableEntry(memo, key, validity);
  if (reused) {
    const { entry } = reused;
    if (entryLive(entry, validity)) {
      assertProjectionVerificationCurrent(stillCurrent);
      return {
        value: entry.value,
        stillCurrent: () => stillCurrent() && entry.stillCurrent(),
      };
    }
    evict(memo, key, reused.pending);
  }
  // Observed before work starts its reads; a derived result keeps its source's.
  const epoch = sourceEpoch ?? validity.epoch();
  const pending = work().then((value) => ({ value, stillCurrent, epoch }));
  memo?.set(key, pending);
  const result = await pending.catch((error: unknown) => {
    evict(memo, key, pending);
    throw error;
  });
  // A hint during production leaves this caller's in-flight view, never a
  // stored one: the stale epoch would evict it anyway.
  if (result.epoch !== validity.epoch()) evict(memo, key, pending);
  assertProjectionVerificationCurrent(result.stillCurrent);
  assertProjectionVerificationCurrent(stillCurrent);
  // stillCurrent already includes the lifetime of a derived value's source.
  return { value: result.value, stillCurrent };
}

function fallsBackOnline(
  input: PrincipalRecoveryContext,
  error: unknown,
): boolean {
  return (
    !input.offline &&
    error instanceof KeyingVerificationError &&
    error.code === "missing_dependency"
  );
}

async function readMemoizedAdmins(
  input: PrincipalRecoveryContext,
  memo: Memo<RecoveredPrincipalPolicyHistory> | undefined,
  scope: readonly (string | boolean)[],
  expectedHead: ReferencedPrincipalHead,
  retainedReferences: readonly ReferencedPrincipalHead[],
) {
  // Every recovered Current already retains its own exact head.
  const references = retainedReferences.filter(
    (reference) => !principalHeadMatchesReference(expectedHead, reference),
  );
  const key = (selected: readonly ReferencedPrincipalHead[]) =>
    serializeKeyingCanonicalJson([
      ...scope,
      { ...expectedHead },
      selected.map((reference) => ({ ...reference })),
    ]);
  const validity = adminsMemoValidity(input, expectedHead);
  const known = (await reusableEntry(memo, key([]), validity))?.entry;
  const sourceCurrent = known?.stillCurrent ?? (() => true);
  const current = () =>
    !input.signal?.aborted && input.stillCurrent() && sourceCurrent();
  return memoPrincipalRecovery(
    memo,
    key(references),
    current,
    validity,
    known?.epoch,
    async () => {
      const options = {
        ...input,
        expectedHead,
        retainedReferences,
        historyVerification: "direct-admins" as const,
        stillCurrent: current,
      };
      if (known) {
        try {
          // A freshly verified exact head only needs local proofs for additional
          // citations; their signature and private-root checks still run.
          return await recoverPrincipalPolicyHistory({
            ...options,
            offline: true,
          });
        } catch (error) {
          assertProjectionVerificationCurrent(current);
          if (!fallsBackOnline(input, error)) throw error;
        }
      }
      return recoverPrincipalPolicyHistory(options);
    },
  );
}

async function readMemoizedDirectory(
  input: PrincipalRecoveryContext,
  memo: Memo<RecoveredPolicyDirectory> | undefined,
  key: (references: readonly ReferencedPrincipalHead[]) => string,
  references: readonly ReferencedPrincipalHead[],
) {
  const validity = directoryMemoValidity(input);
  const known =
    references.length > 0
      ? (await reusableEntry(memo, key([]), validity))?.entry
      : undefined;
  const sourceCurrent = known?.stillCurrent ?? (() => true);
  const current = () =>
    !input.signal?.aborted && input.stillCurrent() && sourceCurrent();
  return memoPrincipalRecovery(
    memo,
    key(references),
    current,
    validity,
    known?.epoch,
    async () => {
      if (!known) return recoverPolicyDirectory(input, references);
      try {
        // Add authenticated historical citations to this operation's exact
        // directory view. A newer private prefix must not silently replace it.
        return await recoverPolicyDirectory(
          { ...input, offline: true, stillCurrent: current },
          references,
          known.value,
        );
      } catch (error) {
        assertProjectionVerificationCurrent(current);
        if (!fallsBackOnline(input, error)) throw error;
      }
      return recoverPolicyDirectory(
        { ...input, stillCurrent: current },
        references,
        known.value,
      );
    },
  );
}

export function createPrincipalRecoveryReader(
  input: PrincipalRecoveryContext,
  memo?: PrincipalRecoveryMemo,
) {
  const scope = [
    input.organizationId,
    input.protection.context,
    input.offline === true,
  ];
  const directoryKey = (references: readonly ReferencedPrincipalHead[]) =>
    serializeKeyingCanonicalJson([
      ...scope,
      references.map((reference) => ({ ...reference })),
    ]);
  // Every lifetime behind a value this reader handed out; its caller must
  // keep checking them at the point of use.
  const lifetimes: (() => boolean)[] = [];
  const lease = <T>(leased: Leased<T>): T => {
    lifetimes.push(leased.stillCurrent);
    return leased.value;
  };
  return {
    stillCurrent: () => lifetimes.every((current) => current()),
    directory: async (references: readonly ReferencedPrincipalHead[]) => {
      const value = lease(
        await readMemoizedDirectory(
          input,
          memo?.directories,
          directoryKey,
          references,
        ),
      );
      // Retaining extra citations does not prevent this authenticated directory
      // from satisfying a later read with no selected historical references.
      const unselectedKey = directoryKey([]);
      const selected = memo?.directories.get(directoryKey(references));
      if (
        memo &&
        selected &&
        references.length > 0 &&
        !memo.directories.has(unselectedKey)
      )
        // The alias keeps the original lease and validity; either ending evicts it.
        memo.directories.set(unselectedKey, selected);
      return value;
    },
    admins: async (
      expectedHead: ReferencedPrincipalHead,
      retainedReferences: readonly ReferencedPrincipalHead[] = [],
    ) =>
      lease(
        await readMemoizedAdmins(
          input,
          memo?.admins,
          scope,
          expectedHead,
          retainedReferences,
        ),
      ),
  };
}

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
  /** Organization hint epoch observed before production. */
  readonly epoch: number;
}

type Memo<T> = Map<string, Promise<MemoEntry<T>>>;

export interface PrincipalRecoveryMemo {
  readonly directories: Memo<RecoveredPolicyDirectory>;
  readonly admins: Memo<RecoveredPrincipalPolicyHistory>;
}

/** Evict an entry whose producer lease ended or whose evidence went stale. */
async function reusableEntry<T>(
  memo: Memo<T> | undefined,
  key: string,
  validity: PrincipalRecoveryMemoValidity<T>,
): Promise<MemoEntry<T> | undefined> {
  const pending = memo?.get(key);
  if (!pending) return undefined;
  const entry = await pending.catch(() => undefined);
  if (
    entry &&
    entry.epoch === validity.epoch() &&
    (await validity.covers(entry.value)) &&
    entry.stillCurrent()
  )
    return entry;
  if (memo?.get(key) === pending) memo.delete(key);
  return undefined;
}

/**
 * Share authenticated results within one workflow operation. A later caller
 * never receives a result whose producer lease ended, that predates an
 * organization hint, or that a durable pin has moved past; it recovers again.
 */
async function memoPrincipalRecovery<T>(
  memo: Memo<T> | undefined,
  key: string,
  stillCurrent: () => boolean,
  validity: PrincipalRecoveryMemoValidity<T>,
  work: () => Promise<T>,
): Promise<T> {
  assertProjectionVerificationCurrent(stillCurrent);
  const reused = await reusableEntry(memo, key, validity);
  if (reused) {
    assertProjectionVerificationCurrent(stillCurrent);
    return reused.value;
  }
  const epoch = validity.epoch();
  const pending = work().then((value) => ({ value, stillCurrent, epoch }));
  memo?.set(key, pending);
  const result = await pending.catch((error: unknown) => {
    if (memo?.get(key) === pending) memo.delete(key);
    throw error;
  });
  assertProjectionVerificationCurrent(result.stillCurrent);
  assertProjectionVerificationCurrent(stillCurrent);
  return result.value;
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
  const known = await reusableEntry(memo, key([]), validity);
  const sourceCurrent = known?.stillCurrent ?? (() => true);
  const current = () =>
    !input.signal?.aborted && input.stillCurrent() && sourceCurrent();
  return memoPrincipalRecovery(
    memo,
    key(references),
    current,
    validity,
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
      ? await reusableEntry(memo, key([]), validity)
      : undefined;
  const sourceCurrent = known?.stillCurrent ?? (() => true);
  const current = () =>
    !input.signal?.aborted && input.stillCurrent() && sourceCurrent();
  return memoPrincipalRecovery(
    memo,
    key(references),
    current,
    validity,
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
  return {
    directory: async (references: readonly ReferencedPrincipalHead[]) => {
      const value = await readMemoizedDirectory(
        input,
        memo?.directories,
        directoryKey,
        references,
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
    admins: (
      expectedHead: ReferencedPrincipalHead,
      retainedReferences: readonly ReferencedPrincipalHead[] = [],
    ) =>
      readMemoizedAdmins(
        input,
        memo?.admins,
        scope,
        expectedHead,
        retainedReferences,
      ),
  };
}

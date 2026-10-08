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
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

type Memo<T> = Map<string, Promise<{ value: T; stillCurrent: () => boolean }>>;

export interface PrincipalRecoveryMemo {
  readonly directories: Memo<RecoveredPolicyDirectory>;
  readonly admins: Memo<RecoveredPrincipalPolicyHistory>;
}

/** Only share authenticated results within one projection collection lifetime. */
async function memoPrincipalRecovery<T>(
  memo: Memo<T> | undefined,
  key: string,
  stillCurrent: () => boolean,
  work: () => Promise<T>,
): Promise<T> {
  assertProjectionVerificationCurrent(stillCurrent);
  let pending = memo?.get(key);
  if (!pending) {
    pending = work().then((value) => ({ value, stillCurrent }));
    memo?.set(key, pending);
  }
  const result = await pending.catch((error: unknown) => {
    if (memo?.get(key) === pending) memo.delete(key);
    throw error;
  });
  assertProjectionVerificationCurrent(result.stillCurrent);
  assertProjectionVerificationCurrent(stillCurrent);
  return result.value;
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
  const known = memo?.get(key([]));
  let sourceCurrent = () => true;
  const current = () =>
    !input.signal?.aborted && input.stillCurrent() && sourceCurrent();
  return memoPrincipalRecovery(memo, key(references), current, async () => {
    const options = {
      ...input,
      expectedHead,
      retainedReferences,
      historyVerification: "direct-admins" as const,
      stillCurrent: current,
    };
    if (known) {
      sourceCurrent = (await known).stillCurrent;
      assertProjectionVerificationCurrent(current);
      try {
        // A freshly verified exact head only needs local proofs for additional
        // citations; their signature and private-root checks still run.
        return await recoverPrincipalPolicyHistory({
          ...options,
          offline: true,
        });
      } catch (error) {
        assertProjectionVerificationCurrent(current);
        if (
          input.offline ||
          !(error instanceof KeyingVerificationError) ||
          error.code !== "missing_dependency"
        )
          throw error;
      }
    }
    return recoverPrincipalPolicyHistory(options);
  });
}

async function readMemoizedDirectory(
  input: PrincipalRecoveryContext,
  memo: Memo<RecoveredPolicyDirectory> | undefined,
  key: (references: readonly ReferencedPrincipalHead[]) => string,
  references: readonly ReferencedPrincipalHead[],
) {
  const known = references.length > 0 ? memo?.get(key([])) : undefined;
  let sourceCurrent = () => true;
  const current = () =>
    !input.signal?.aborted && input.stillCurrent() && sourceCurrent();
  return memoPrincipalRecovery(memo, key(references), current, async () => {
    if (!known) return recoverPolicyDirectory(input, references);
    const source = await known;
    sourceCurrent = source.stillCurrent;
    assertProjectionVerificationCurrent(current);
    try {
      // Add authenticated historical citations to this batch's exact directory
      // view. A newer private prefix must not silently replace that view.
      return await recoverPolicyDirectory(
        { ...input, offline: true, stillCurrent: current },
        references,
        source.value,
      );
    } catch (error) {
      assertProjectionVerificationCurrent(current);
      if (
        input.offline ||
        !(error instanceof KeyingVerificationError) ||
        error.code !== "missing_dependency"
      )
        throw error;
    }
    return recoverPolicyDirectory(
      { ...input, stillCurrent: current },
      references,
      source.value,
    );
  });
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
        // Keep the original lease: its expiry requires a new batch, even if
        // a later caller still has a live lease of its own.
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

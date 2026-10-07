import {
  type ReferencedPrincipalHead,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
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

export function createPrincipalRecoveryReader(
  input: PrincipalRecoveryContext,
  memo?: PrincipalRecoveryMemo,
) {
  const scope = [
    input.organizationId,
    input.protection.context,
    input.offline === true,
  ];
  const current = () => !input.signal?.aborted && input.stillCurrent();
  const directoryKey = (references: readonly ReferencedPrincipalHead[]) =>
    serializeKeyingCanonicalJson([
      ...scope,
      references.map((reference) => ({ ...reference })),
    ]);
  return {
    directory: async (references: readonly ReferencedPrincipalHead[]) => {
      const value = await memoPrincipalRecovery(
        memo?.directories,
        directoryKey(references),
        current,
        () => recoverPolicyDirectory(input, references),
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
        // Keep the original result's lease guard when sharing the promise.
        memo.directories.set(unselectedKey, selected);
      return value;
    },
    admins: (
      expectedHead: ReferencedPrincipalHead,
      retainedReferences: readonly ReferencedPrincipalHead[] = [],
    ) =>
      memoPrincipalRecovery(
        memo?.admins,
        serializeKeyingCanonicalJson([
          ...scope,
          { ...expectedHead },
          retainedReferences.map((reference) => ({ ...reference })),
        ]),
        current,
        () =>
          recoverPrincipalPolicyHistory({
            ...input,
            expectedHead,
            retainedReferences,
            historyVerification: "direct-admins",
          }),
      ),
  };
}

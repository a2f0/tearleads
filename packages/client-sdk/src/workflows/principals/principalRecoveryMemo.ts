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
  return {
    directory: (references: readonly ReferencedPrincipalHead[]) =>
      memoPrincipalRecovery(
        memo?.directories,
        serializeKeyingCanonicalJson([
          ...scope,
          references.map((reference) => ({ ...reference })),
        ]),
        current,
        () => recoverPolicyDirectory(input, references),
      ),
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

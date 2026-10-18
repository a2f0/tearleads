import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { getOrCreatePrincipalPolicyCoordinator } from "../../data/principals/principalPolicyCoordinator";
import type { RecoveredPrincipalPolicyHistory } from "./principalHistoryRecoveryTypes";
import type {
  PrincipalRecoveryContext,
  RecoveredPolicyDirectory,
} from "./principalRecoveryDirectory";

/** What keeps a memo entry valid beyond its producer's lease. */
export interface PrincipalRecoveryMemoValidity<T> {
  /** Organization hint epoch; production records it before its reads. */
  readonly epoch: () => number;
  /** No durable pin has moved past or forked from a memoized head. */
  readonly covers: (value: T) => Promise<boolean>;
}

type PinnedHead = Pick<
  ReferencedPrincipalHead,
  "principalType" | "principalId" | "version" | "stateHash"
>;

async function pinCovers(
  input: PrincipalRecoveryContext,
  head: PinnedHead,
): Promise<boolean> {
  const pin = await loadPrincipalPolicyCheckpoint(
    input.execSql,
    head.principalType,
    head.principalId,
  );
  return (
    !pin ||
    pin.version < head.version ||
    (pin.version === head.version && pin.stateHash === head.stateHash)
  );
}

function organizationEpoch(input: PrincipalRecoveryContext) {
  return () =>
    getOrCreatePrincipalPolicyCoordinator(input.execSql).recoveryEpoch(
      input.organizationId,
    );
}

/** A directory names every group head; a newer pin on any of them evicts it. */
export function directoryMemoValidity(
  input: PrincipalRecoveryContext,
): PrincipalRecoveryMemoValidity<RecoveredPolicyDirectory> {
  return {
    epoch: organizationEpoch(input),
    covers: async (directory) => {
      for (const head of [
        directory.policy.state,
        ...directory.descriptor.groupHeads,
      ])
        if (!(await pinCovers(input, head))) return false;
      return true;
    },
  };
}

export function adminsMemoValidity(
  input: PrincipalRecoveryContext,
  expectedHead: PinnedHead,
): PrincipalRecoveryMemoValidity<RecoveredPrincipalPolicyHistory> {
  return {
    epoch: organizationEpoch(input),
    covers: () => pinCovers(input, expectedHead),
  };
}

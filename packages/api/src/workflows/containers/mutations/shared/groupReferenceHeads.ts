import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { ContainerGrantPrincipalHead } from "@tearleads/crypto";
import { getCurrentPrincipalStates } from "../../../../access/read/principalStateStore";
import { ContainerMutationError } from "../errors";

/** Caller holds each group's shared reference lock through transaction commit. */
export async function assertGroupReferenceHeadsCurrent(
  executor: DatabaseTransaction,
  references: readonly ContainerGrantPrincipalHead[],
): Promise<void> {
  const current = await getCurrentPrincipalStates(
    "group",
    references.map((head) => head.principalId),
    executor,
  );
  for (const head of references) {
    const state = current.get(head.principalId);
    if (
      !state ||
      state.version !== head.version ||
      state.keyEpoch !== head.keyEpoch ||
      state.stateHash !== head.stateHash ||
      state.keyFingerprint !== head.keyFingerprint
    ) {
      throw new ContainerMutationError(
        "Container group reference is not current",
        409,
      );
    }
  }
}

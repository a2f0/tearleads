import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import {
  principalStateReferenceKey,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";

/** Each subset proves its retained citations connect to the same exact head. */
export async function loadPrincipalPolicyReferenceBatches(
  executor: DatabaseSession,
  head: StoredPrincipalState,
  references: readonly ReferencedPrincipalHead[],
) {
  const distinct = [
    ...new Map(
      references.map((reference) => [
        principalStateReferenceKey(reference),
        reference,
      ]),
    ).values(),
  ];
  const batches: Awaited<
    ReturnType<typeof getVerifiedPrincipalPolicyForStateWithExecutor>
  >[] = [];
  for (
    let offset = 0;
    offset < Math.max(1, distinct.length);
    offset += PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT
  ) {
    batches.push(
      await getVerifiedPrincipalPolicyForStateWithExecutor(
        executor,
        head,
        distinct.slice(offset, offset + PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT),
      ),
    );
  }
  return batches;
}

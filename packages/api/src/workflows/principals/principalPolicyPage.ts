import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { PrincipalPolicyPageResponse } from "@tearleads/validators/response";
import { PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT } from "@tearleads/validators/util";
import { readPrincipalHistoryPage } from "../../access/read/principalHistoryProgress";
import type { StoredPrincipalState } from "../../access/read/principalStateStore";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";
import { PrincipalPolicyError } from "./shared";

/** Verify exactly the returned rows against the prepared prefix's private root. */
export async function buildPrincipalPolicyPage(
  executor: DatabaseSession,
  head: StoredPrincipalState,
  afterVersion: number,
): Promise<PrincipalPolicyPageResponse> {
  if (
    !Number.isSafeInteger(afterVersion) ||
    afterVersion < 0 ||
    afterVersion >= head.version
  )
    throw new PrincipalPolicyError("Invalid principal history cursor", 400);
  const remaining = head.version - 1 - afterVersion;
  const throughVersion =
    afterVersion + Math.min(remaining, PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT);
  const rows =
    remaining === 0
      ? []
      : await readPrincipalHistoryPage(executor, {
          principalType: head.principalType,
          principalId: head.principalId,
          afterVersion,
          throughVersion,
        });
  if (
    rows.length !== throughVersion - afterVersion ||
    rows.some((row, index) => row.state.version !== afterVersion + index + 1)
  )
    throw new PrincipalPolicyError(
      "Stored principal history page is incomplete",
      409,
    );
  const { bundle, policy } =
    await getVerifiedPrincipalPolicyForStateWithExecutor(
      executor,
      head,
      rows.map(({ state }) => state),
    );
  const previousStates = policy.retainedHistory
    .filter(({ state }) => state.version < head.version)
    .map((entry) => {
      const row = rows[entry.state.version - afterVersion - 1];
      if (!row)
        throw new PrincipalPolicyError(
          "Stored principal history page differs",
          409,
        );
      return {
        state: { ...entry.state, createdAt: row.state.createdAt.toISOString() },
        projection: [...entry.projection],
        grants: [...entry.grants],
      };
    });
  return {
    ...bundle,
    previousStates,
    historyPage: {
      afterVersion,
      nextAfterVersion:
        throughVersion === head.version - 1 ? null : throughVersion,
    },
  };
}

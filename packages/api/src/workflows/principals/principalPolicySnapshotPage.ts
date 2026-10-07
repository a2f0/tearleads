import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { selectPrincipalPolicyAuthorization } from "@tearleads/crypto";
import type { PrincipalPolicySnapshotPageResponse } from "@tearleads/validators/response";
import { PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT } from "@tearleads/validators/util";
import { readPrincipalHistoryPage } from "../../access/read/principalHistoryProgress";
import type { StoredPrincipalState } from "../../access/read/principalStateStore";
import { getVerifiedPrincipalHistory } from "./getVerifiedPrincipalHistory";
import { PrincipalPolicyError } from "./shared";

/** Public signed history only. Callers must authorize its object or organization scope. */
export async function buildPrincipalPolicySnapshotPage(
  executor: DatabaseSession,
  head: StoredPrincipalState,
  afterVersion: number,
): Promise<PrincipalPolicySnapshotPageResponse> {
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
  const history = await getVerifiedPrincipalHistory(
    executor,
    head,
    rows.map(({ state }) => state),
  );
  const selected = await selectPrincipalPolicyAuthorization(history);
  if (!selected.ok) throw new PrincipalPolicyError(selected.error.message, 409);
  const policy = selected.value;
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
    currentState: { ...policy.state, createdAt: head.createdAt.toISOString() },
    currentProjection: [...policy.projection],
    currentGrants: [...policy.grants],
    previousStates,
    historyPage: {
      afterVersion,
      nextAfterVersion:
        throughVersion === head.version - 1 ? null : throughVersion,
    },
  };
}

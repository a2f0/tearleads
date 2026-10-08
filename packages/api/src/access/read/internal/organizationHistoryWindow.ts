import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import { PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE } from "@tearleads/validators/response";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { beginPrincipalHistoryVerification } from "../../../utils/principalHistoryWork";
import {
  principalStatePayloadSelect,
  principalStateSelect,
  toStoredPrincipalState,
} from "../../shared/internal/principalStateRecords";

/** At most 32 display entries and their immediate predecessor. */
export async function loadOrganizationHistoryWindow(
  executor: DatabaseSession,
  organizationId: string,
  beforeVersion: number,
) {
  beginPrincipalHistoryVerification();
  const firstVersion = Math.max(
    1,
    beforeVersion - PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE - 1,
  );
  const rows = await executor
    .select({
      state: principalStateSelect,
      payload: principalStatePayloadSelect,
    })
    .from(principalStates)
    .innerJoin(
      principalStatePayloads,
      and(
        eq(principalStates.principalType, principalStatePayloads.principalType),
        eq(principalStates.principalId, principalStatePayloads.principalId),
        eq(principalStates.stateHash, principalStatePayloads.stateHash),
      ),
    )
    .where(
      and(
        eq(principalStates.principalType, "organization"),
        eq(principalStates.principalId, organizationId),
        gte(principalStates.version, firstVersion),
        lt(principalStates.version, beforeVersion),
      ),
    )
    .orderBy(asc(principalStates.version))
    .limit(PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE + 1);
  return rows.map(({ state, payload }) => ({
    state: toStoredPrincipalState(state),
    payload,
  }));
}

import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  selectOldestPrincipalHistoryProgressId,
  selectPrincipalHistoryProgress,
} from "../../access/read/principalHistoryProgress";
import { sha256Hex } from "../../utils/sha256";
import type { PrincipalHistoryPreparationRequest } from "./principalHistoryPreparationRequest";
import { principalHistoryProtection } from "./principalHistoryProtection";

/** A cache-change stamp for retry scheduling, never evidence of authorization. */
export async function principalHistoryContinuationProgress(
  executor: DatabaseSession,
  request: PrincipalHistoryPreparationRequest,
): Promise<string> {
  const local = principalHistoryProtection(
    {
      principalType: request.head.principalType,
      principalId: request.head.principalId,
      retainedReferences: [],
    },
    request.kind,
  );
  try {
    const row = await selectPrincipalHistoryProgress(executor, {
      ...local.scope,
      throughVersion: request.head.version,
    });
    const oldest = await selectOldestPrincipalHistoryProgressId(executor, {
      ...local.scope,
      throughVersion: request.head.version,
    });
    return sha256Hex(
      JSON.stringify([
        local.scope,
        request.head.version,
        request.head.stateHash,
        oldest,
        row
          ? [row.id, row.version, row.stateHash, sha256Hex(row.progress)]
          : null,
      ]),
    );
  } finally {
    local.protection.localKey.fill(0);
  }
}

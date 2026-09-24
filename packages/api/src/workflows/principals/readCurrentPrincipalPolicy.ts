import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { getPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";
import { assertPrincipalPolicyReadable } from "./principalPolicyReadAuthorization";
import { PrincipalPolicyError } from "./shared";

/**
 * The authenticated HTTP read of a principal policy bundle. Kept apart from
 * `getCurrentPrincipalPolicy.ts`, which the container writer projection
 * imports while it resolves referenced policies: the authorization here reads
 * container access back through that projection, so folding it in would close
 * an import cycle. Server-side callers that already hold a verified access
 * path read bundles by state through `getPrincipalPolicyForStateWithExecutor`
 * without this check.
 */
export async function runReadCurrentPrincipalPolicyWorkflow(
  db: ApiDatabase,
  input: {
    readonly principalId: string;
    readonly principalType: ManagedRecipientPrincipalType;
    readonly requesterUserId: string;
  },
): Promise<PrincipalPolicyBundleResponse> {
  return db.transaction(async (tx) => {
    const currentState = await getCurrentPrincipalState(
      input.principalType,
      input.principalId,
      tx,
    );
    if (!currentState) {
      throw new PrincipalPolicyError("Principal policy access denied", 403);
    }
    await assertPrincipalPolicyReadable({
      currentState,
      executor: tx,
      requesterUserId: input.requesterUserId,
    });
    return getPrincipalPolicyForStateWithExecutor(tx, currentState);
  });
}

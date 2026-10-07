import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { principalPolicyCommits } from "@tearleads/api-shared/schema";
import type { PrincipalPolicyMutationResponse } from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { principalHistoryHead } from "./principalHistoryRecords";
import { lockPrincipalMutationInTransaction } from "./principalMutationLock";
import type { PutPrincipalPolicyInput } from "./principalPolicyMutationAuthorization";
import { principalPolicyOutcomeHash } from "./principalPolicyOutcomeHash";
import { loadPrincipalPolicyOutcomeReference } from "./principalPolicyOutcomeReference";
import { PrincipalPolicyError } from "./shared";

/** Only standalone directory requests use this domain; compound commits have their own receipt. */
export async function principalOrganizationPolicyOutcome(
  executor: DatabaseTransaction,
  input: PutPrincipalPolicyInput,
) {
  const organizationId = input.expectedPrincipalId;
  await lockPrincipalMutationInTransaction(
    executor,
    "organization",
    organizationId,
  );
  const requestHash = principalPolicyOutcomeHash([
    "tearleads.principal-policy.organization.v1",
    organizationId,
    input.requesterUserId,
    input,
  ]);
  const [row] = await executor
    .select()
    .from(principalPolicyCommits)
    .where(
      and(
        eq(principalPolicyCommits.requestHash, requestHash),
        eq(principalPolicyCommits.organizationId, organizationId),
        eq(principalPolicyCommits.requesterUserId, input.requesterUserId),
        isNull(principalPolicyCommits.groupId),
      ),
    )
    .limit(1);
  let response: PrincipalPolicyMutationResponse | null = null;
  if (row) {
    await requireDirectOrganizationAccess({
      executor,
      organizationId,
      userId: input.requesterUserId,
      requireAdmin: true,
    });
    let stored: unknown;
    try {
      stored = JSON.parse(row.responseJson);
    } catch {
      throw new PrincipalPolicyError(
        "Stored organization policy acknowledgement is invalid",
        409,
      );
    }
    response = await loadPrincipalPolicyOutcomeReference({
      executor,
      reference: stored,
      request: input,
      principalType: "organization",
      principalId: organizationId,
    });
  }
  return {
    response,
    async save(policy: PrincipalPolicyMutationResponse): Promise<void> {
      await executor.insert(principalPolicyCommits).values({
        requestHash,
        organizationId,
        groupId: null,
        requesterUserId: input.requesterUserId,
        responseJson: JSON.stringify(principalHistoryHead(policy.currentState)),
      });
    },
  };
}

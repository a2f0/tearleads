import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { principalPolicyCommits } from "@tearleads/api-shared/schema";
import type {
  CreateOrganizationGroupWithPolicyRequest,
  DeleteOrganizationGroupRequest,
} from "@tearleads/validators/request";
import { and, eq, isNull } from "drizzle-orm";
import { principalPolicyOutcomeHash } from "../principals/principalPolicyOutcomeHash";
import { requireDirectOrganizationAccess } from "./access";
import { OrganizationManagerError } from "./errors";

/** The caller holds the organization/group mutation locks through lookup and save. */
export async function organizationGroupOperationReceipt(
  executor: DatabaseTransaction,
  input: {
    readonly operation: "create" | "delete";
    readonly organizationId: string;
    readonly groupId: string;
    readonly sessionUserId: string;
    readonly request:
      | CreateOrganizationGroupWithPolicyRequest
      | DeleteOrganizationGroupRequest;
  },
) {
  const requestHash = principalPolicyOutcomeHash([
    `tearleads.principal-policy.group-${input.operation}.v1`,
    input.organizationId,
    input.groupId,
    input.sessionUserId,
    input.request,
  ]);
  // A deletion receipt must survive removal of its target group. Its exact
  // target remains bound by the request hash; organization purge removes it.
  const groupId = input.operation === "create" ? input.groupId : null;
  const [row] = await executor
    .select()
    .from(principalPolicyCommits)
    .where(
      and(
        eq(principalPolicyCommits.requestHash, requestHash),
        eq(principalPolicyCommits.organizationId, input.organizationId),
        eq(principalPolicyCommits.requesterUserId, input.sessionUserId),
        groupId === null
          ? isNull(principalPolicyCommits.groupId)
          : eq(principalPolicyCommits.groupId, groupId),
      ),
    )
    .limit(1);
  let stored: unknown = null;
  if (row) {
    await requireDirectOrganizationAccess({
      executor,
      organizationId: input.organizationId,
      userId: input.sessionUserId,
      requireAdmin: true,
    });
    try {
      stored = JSON.parse(row.responseJson);
    } catch {
      throw new OrganizationManagerError(
        "Stored group operation acknowledgement is invalid",
        409,
      );
    }
  }
  return {
    found: row !== undefined,
    stored,
    async save(references: unknown) {
      await executor.insert(principalPolicyCommits).values({
        requestHash,
        organizationId: input.organizationId,
        groupId,
        requesterUserId: input.sessionUserId,
        responseJson: JSON.stringify(references),
      });
    },
  };
}

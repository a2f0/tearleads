import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import type {
  CreateOrganizationGroupWithPolicyRequest,
  DeleteOrganizationGroupRequest,
} from "@tearleads/validators/request";
import type {
  CreateOrganizationGroupResponse,
  DeleteOrganizationGroupResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { principalHistoryHead } from "../principals/principalHistoryRecords";
import { loadPrincipalPolicyOutcomeReference } from "../principals/principalPolicyOutcomeReference";
import { OrganizationManagerError } from "./errors";
import { toGroupSummary } from "./groupSummary";
import { organizationGroupOperationReceipt } from "./organizationGroupOperationReceipt";

interface OperationInput {
  readonly organizationId: string;
  readonly groupId: string;
  readonly sessionUserId: string;
}

export async function organizationGroupCreationOutcome(
  executor: DatabaseTransaction,
  input: OperationInput & {
    readonly request: CreateOrganizationGroupWithPolicyRequest;
  },
) {
  const receipt = await organizationGroupOperationReceipt(executor, {
    ...input,
    operation: "create",
  });
  let response: CreateOrganizationGroupResponse | null = null;
  if (receipt.found) {
    const { stored } = receipt;
    if (
      !stored ||
      typeof stored !== "object" ||
      !("groupPolicy" in stored) ||
      !("organizationPolicy" in stored)
    )
      throw new OrganizationManagerError(
        "Stored group creation acknowledgement is invalid",
        409,
      );
    const groupPolicy = await loadPrincipalPolicyOutcomeReference({
      executor,
      reference: stored.groupPolicy,
      request: input.request.initialGroupPolicy,
      principalType: "group",
      principalId: input.groupId,
    });
    const organizationPolicy = await loadPrincipalPolicyOutcomeReference({
      executor,
      reference: stored.organizationPolicy,
      request: input.request.organizationPolicy,
      principalType: "organization",
      principalId: input.organizationId,
    });
    const [group] = await executor
      .select({ createdAt: groups.createdAt })
      .from(groups)
      .where(
        and(
          eq(groups.id, input.groupId),
          eq(groups.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    if (!group)
      throw new OrganizationManagerError(
        "Acknowledged group is no longer available",
        409,
      );
    response = {
      group: toGroupSummary({
        ...input,
        createdAt: group.createdAt,
        isBuiltin: false,
        state: {
          ...groupPolicy.currentState,
          memberCount: groupPolicy.currentProjection.length,
        },
      }),
      organizationPolicy,
    };
  }
  return {
    response,
    async save(result: CreateOrganizationGroupResponse) {
      if (!result.group.currentState)
        throw new Error("Created group has no acknowledged policy");
      await receipt.save({
        groupPolicy: principalHistoryHead({
          ...input.request.initialGroupPolicy.state,
          stateHash: result.group.currentState.stateHash,
        }),
        organizationPolicy: principalHistoryHead(
          result.organizationPolicy.currentState,
        ),
      });
    },
  };
}

export async function organizationGroupDeletionOutcome(
  executor: DatabaseTransaction,
  input: OperationInput & { readonly request: DeleteOrganizationGroupRequest },
) {
  const receipt = await organizationGroupOperationReceipt(executor, {
    ...input,
    operation: "delete",
  });
  const response: DeleteOrganizationGroupResponse | null = receipt.found
    ? {
        deleted: true,
        groupId: input.groupId,
        organizationId: input.organizationId,
        organizationPolicy: await loadPrincipalPolicyOutcomeReference({
          executor,
          reference: receipt.stored,
          request: input.request.organizationPolicy,
          principalType: "organization",
          principalId: input.organizationId,
        }),
      }
    : null;
  return {
    response,
    save(result: DeleteOrganizationGroupResponse) {
      return receipt.save(
        principalHistoryHead(result.organizationPolicy.currentState),
      );
    },
  };
}

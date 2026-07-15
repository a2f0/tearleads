import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { groups as groupsTable } from "@tearleads/api-shared/schema";
import type { CreateOrganizationGroupRequest } from "@tearleads/validators/request";
import type { OrganizationGroupSummaryResponse } from "@tearleads/validators/response";
import { assertOrganizationCanSync } from "../../billing/organizationBilling";
import { toPrincipalPolicyError } from "../../principals/shared";
import { storeVerifiedPrincipalPolicyInTransaction } from "../../principals/storeVerifiedPrincipalPolicy";
import { requireDirectOrganizationAccess } from "../access";
import { OrganizationManagerError } from "../errors";
import { toGroupSummary } from "../groupSummary";

function toPrincipalWriteError(
  error: unknown,
): OrganizationManagerError | null {
  const policyError = toPrincipalPolicyError(error);
  return policyError
    ? new OrganizationManagerError(policyError.message, policyError.status)
    : null;
}

export async function runCreateOrganizationGroupWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  input: CreateOrganizationGroupRequest,
): Promise<OrganizationGroupSummaryResponse> {
  const name = input.name.trim();

  if (name.length === 0) {
    throw new OrganizationManagerError("Group name cannot be empty", 400);
  }

  if (input.initialGroupPolicy.state.principalType !== "group") {
    throw new OrganizationManagerError(
      "Initial group policy must target a group principal",
      400,
    );
  }

  if (input.initialGroupPolicy.state.principalId !== input.groupId) {
    throw new OrganizationManagerError(
      "Initial group policy principalId must match groupId",
      400,
    );
  }

  if (input.initialGroupPolicy.state.version !== 1) {
    throw new OrganizationManagerError(
      "Initial group policy version must be 1",
      400,
    );
  }

  return db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      requireAdmin: true,
      userId: sessionUserId,
    });
    await assertOrganizationCanSync(tx, organizationId);

    const [insertedGroup] = await tx
      .insert(groupsTable)
      .values({
        id: input.groupId,
        organizationId,
        name,
      })
      .onConflictDoNothing({ target: groupsTable.id })
      .returning({
        groupId: groupsTable.id,
        organizationId: groupsTable.organizationId,
        name: groupsTable.name,
        createdAt: groupsTable.createdAt,
      });

    if (!insertedGroup) {
      throw new OrganizationManagerError("Group already exists", 409);
    }

    try {
      const storedState = await storeVerifiedPrincipalPolicyInTransaction(
        {
          state: input.initialGroupPolicy.state,
          encryptedPayload: input.initialGroupPolicy.encryptedPayload,
          projection: input.initialGroupPolicy.projection,
          memberEnvelopes: input.initialGroupPolicy.memberEnvelopes,
        },
        tx,
        {
          authorizeExternalAdminSigner: (authorization) =>
            Promise.resolve(authorization.signerUserId === sessionUserId),
        },
      );

      return toGroupSummary({
        createdAt: insertedGroup.createdAt,
        groupId: insertedGroup.groupId,
        isBuiltin: false,
        name: insertedGroup.name,
        organizationId,
        state: storedState,
      });
    } catch (error) {
      const organizationManagerError = toPrincipalWriteError(error);
      if (organizationManagerError) {
        throw organizationManagerError;
      }

      throw error;
    }
  });
}

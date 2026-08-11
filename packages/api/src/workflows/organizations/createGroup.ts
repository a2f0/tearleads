import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import { groups as groupsTable } from "@tearleads/api-shared/schema";
import type { CreateOrganizationGroupRequest } from "@tearleads/validators/request";
import type { OrganizationGroupSummaryResponse } from "@tearleads/validators/response";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { assertOrganizationCanSync } from "../billing/organizationSyncEligibility";
import { assertManagedPrincipalRosterMembership } from "../principals/managedPrincipalRosterMembership";
import { lockPrincipalMutationInTransaction } from "../principals/principalMutationLock";
import {
  PrincipalPolicyError,
  toPrincipalPolicyError,
} from "../principals/shared";
import { storeVerifiedPrincipalPolicyInTransaction } from "../principals/storeVerifiedPrincipalPolicy";
import { requireDirectOrganizationAccess } from "./access";
import { OrganizationManagerError } from "./errors";
import { toGroupSummary } from "./groupSummary";
import { wasOrganizationGroupDeleted } from "./groupTombstone";
import { requireSerializedOrganizationMutationAccess } from "./mutationAccess";
import { isCurrentOrganizationAdminAuthority } from "./principalPolicyExternalAuthority";
import { appendOrganizationReadModelChangeInTransaction } from "./readModelChanges";

function toPrincipalWriteError(
  error: unknown,
): OrganizationManagerError | null {
  // `toPrincipalPolicyError` only recognises state and envelope failures, so a
  // PrincipalPolicyError raised directly — the roster rules below — would fall
  // through to a 500 without this.
  const policyError =
    error instanceof PrincipalPolicyError
      ? error
      : toPrincipalPolicyError(error);
  return policyError
    ? new OrganizationManagerError(policyError.message, policyError.status)
    : null;
}

async function prepareOrganizationGroupCreation(input: {
  readonly organizationId: string;
  readonly request: CreateOrganizationGroupRequest;
  readonly sessionUserId: string;
  readonly tx: DatabaseTransaction;
}): Promise<void> {
  await requireDirectOrganizationAccess({
    executor: input.tx,
    organizationId: input.organizationId,
    requireAdmin: true,
    userId: input.sessionUserId,
  });
  await lockPrincipalMutationInTransaction(
    input.tx,
    "group",
    input.request.groupId,
  );
  await requireSerializedOrganizationMutationAccess({
    organizationId: input.organizationId,
    requireAdmin: true,
    tx: input.tx,
    userId: input.sessionUserId,
  });
  await assertOrganizationCanSync(
    input.tx,
    input.organizationId,
    input.sessionUserId,
  );
  if (
    await wasOrganizationGroupDeleted({
      executor: input.tx,
      groupId: input.request.groupId,
    })
  ) {
    throw new OrganizationManagerError(
      "Deleted organization group IDs cannot be reused",
      409,
    );
  }
  if (
    await getCurrentPrincipalState("group", input.request.groupId, input.tx)
  ) {
    throw new OrganizationManagerError("Group principal already exists", 409);
  }
}

async function appendCreatedGroupReadModelChanges(input: {
  readonly groupId: string;
  readonly organizationId: string;
  readonly tx: DatabaseTransaction;
}): Promise<void> {
  await appendOrganizationReadModelChangeInTransaction(input.tx, {
    organizationId: input.organizationId,
    lane: "groups",
    entityId: input.groupId,
    operation: "upsert",
  });
  await appendOrganizationReadModelChangeInTransaction(input.tx, {
    organizationId: input.organizationId,
    lane: "groupMemberships",
    entityId: input.groupId,
    operation: "replace",
  });
}

function validateOrganizationGroupCreation(
  input: CreateOrganizationGroupRequest,
): string {
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
  if (input.initialGroupPolicy.grants.length !== 0) {
    throw new OrganizationManagerError(
      "New organization groups must begin with an empty grant index",
      400,
    );
  }
  return name;
}

export async function runCreateOrganizationGroupWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  input: CreateOrganizationGroupRequest,
): Promise<OrganizationGroupSummaryResponse> {
  const name = validateOrganizationGroupCreation(input);

  return db.transaction(async (tx) => {
    await prepareOrganizationGroupCreation({
      organizationId,
      request: input,
      sessionUserId,
      tx,
    });

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
          grants: input.initialGroupPolicy.grants,
          memberEnvelopes: input.initialGroupPolicy.memberEnvelopes,
        },
        tx,
        {
          authorizeExternalAdminSigner: (authorization) =>
            authorization.signerUserId === sessionUserId
              ? isCurrentOrganizationAdminAuthority({
                  executor: tx,
                  organizationId,
                  signerUserId: authorization.signerUserId,
                  submittedAuthority:
                    authorization.normalizedInput.state.externalAuthority,
                })
              : Promise.resolve(false),
        },
      );

      // A brand-new group's initial policy goes through this route rather than
      // the policy PUT, so it needs the same roster rule: a group must not be
      // stood up already naming a disabled user, which would hand back access
      // the organization revoked.
      await assertManagedPrincipalRosterMembership({
        organizationId,
        principalId: input.groupId,
        principalType: "group",
        tx,
      });

      await appendCreatedGroupReadModelChanges({
        groupId: input.groupId,
        organizationId,
        tx,
      });

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

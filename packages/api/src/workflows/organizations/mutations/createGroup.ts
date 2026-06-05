import type { CreateOrganizationGroupRequest } from "@tearleads/validators/request";
import type { OrganizationGroupSummaryResponse } from "@tearleads/validators/response";
import { replaceCurrentPrincipalMemberEnvelopesInTransaction } from "../../../access/write/principalMemberEnvelopes";
import { storeVerifiedPrincipalStateInTransaction } from "../../../access/write/principalStateStore";
import type { ApiDatabase } from "../../../adapters/postgres";
import { groups as groupsTable } from "../../../schema";
import { requireDirectOrganizationAccess } from "../access";
import { OrganizationManagerError } from "../errors";
import { toGroupSummary } from "../groupSummary";

function toPrincipalWriteError(
  error: unknown,
): OrganizationManagerError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (
    error.message === "Invalid principal state signature" ||
    error.message === "Principal state signer user not found" ||
    error.message === "Principal state signer fingerprint mismatch" ||
    error.message === "Principal state signer must be an admin"
  ) {
    return new OrganizationManagerError(error.message, 403);
  }

  if (
    error.message === "Principal state version conflict" ||
    error.message === "Principal epoch key conflict" ||
    error.message === "Principal state previous hash mismatch" ||
    error.message === "Principal state payload conflict" ||
    error.message === "Principal state projection conflict" ||
    error.message === "Principal member envelopes must target the current state"
  ) {
    return new OrganizationManagerError(error.message, 409);
  }

  if (
    error.message ===
      "Principal state payload ciphertext hash does not match ciphertext" ||
    error.message ===
      "Principal state payloadCiphertextHash does not match encrypted payload" ||
    error.message ===
      "Principal state projectionRoot does not match projection" ||
    error.message === "Principal state memberCount does not match projection"
  ) {
    return new OrganizationManagerError(error.message, 400);
  }

  if (
    error.message ===
      "Principal member envelopes must match the current direct member set" ||
    error.message ===
      "Principal member envelopes must cover the current direct member set" ||
    error.message.startsWith(
      "Principal member envelope targets unknown member",
    ) ||
    error.message.startsWith(
      "Principal member envelope fingerprint mismatch",
    ) ||
    error.message.startsWith(
      "Missing user recipient key for principal state member",
    ) ||
    error.message.startsWith(
      "Missing current principal epoch key for group member",
    )
  ) {
    return new OrganizationManagerError(error.message, 409);
  }

  if (
    error.message.startsWith(
      "Principal member envelope is missing wrapped material",
    )
  ) {
    return new OrganizationManagerError(error.message, 400);
  }

  return null;
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
      const storedState = await storeVerifiedPrincipalStateInTransaction(
        {
          state: input.initialGroupPolicy.state,
          encryptedPayload: input.initialGroupPolicy.encryptedPayload,
          projection: input.initialGroupPolicy.projection,
        },
        tx,
        {
          authorizeExternalAdminSigner: (authorization) =>
            Promise.resolve(authorization.signerUserId === sessionUserId),
        },
      );

      await replaceCurrentPrincipalMemberEnvelopesInTransaction(
        {
          principalType: "group",
          principalId: input.groupId,
          stateHash: storedState.stateHash,
          envelopes: input.initialGroupPolicy.memberEnvelopes,
        },
        tx,
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

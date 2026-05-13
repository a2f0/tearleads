import type { CreateOrganizationGroupRequest } from "@tearleads/validators/request";
import type {
  ListOrganizationGroupsResponse,
  OrganizationDirectoryResponse,
  OrganizationGroupMembersResponse,
  OrganizationGroupSummaryResponse,
  OrganizationRole,
} from "@tearleads/validators/response";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  getCurrentPrincipalState,
  getCurrentPrincipalStates,
  listCurrentPrincipalProjectionMembers,
  type StoredPrincipalProjectionMember,
} from "../../access/read/principalStateStore";
import { replaceCurrentPrincipalMemberEnvelopesInTransaction } from "../../access/write/principalMemberEnvelopes";
import { storeVerifiedPrincipalStateInTransaction } from "../../access/write/principalStateStore";
import type { ApiDatabase, DatabaseSession } from "../../adapters/postgres";
import { groups, users } from "../../schema";

type OrganizationManagerErrorStatus = 400 | 403 | 404 | 409;

export class OrganizationManagerError extends Error {
  constructor(
    message: string,
    readonly status: OrganizationManagerErrorStatus,
  ) {
    super(message);
  }
}

interface OrganizationAccess {
  role: OrganizationRole;
}

interface UserKeyRow {
  userId: string;
  signingKeyFingerprint: string;
  signingPublicKey: string;
  encapsulationPublicKey: string;
  encapsulationKeyFingerprint: string;
  createdAt: Date;
}

interface NestedGroupRow {
  groupId: string;
  groupName: string;
}

async function loadDirectOrganizationAccess(input: {
  executor: DatabaseSession;
  organizationId: string;
  userId: string;
}): Promise<OrganizationAccess | null> {
  const state = await getCurrentPrincipalState(
    "organization",
    input.organizationId,
    input.executor,
  );

  if (!state) {
    throw new OrganizationManagerError("Organization policy not found", 404);
  }

  const projection = await listCurrentPrincipalProjectionMembers(
    "organization",
    input.organizationId,
    input.executor,
  );
  const member = projection.find(
    (entry) =>
      entry.memberPrincipalType === "user" &&
      entry.memberPrincipalId === input.userId,
  );

  return member ? { role: member.role } : null;
}

async function requireDirectOrganizationAccess(input: {
  executor: DatabaseSession;
  organizationId: string;
  requireAdmin?: boolean;
  userId: string;
}): Promise<OrganizationAccess> {
  const access = await loadDirectOrganizationAccess(input);

  if (!access) {
    throw new OrganizationManagerError("Organization access denied", 403);
  }

  if (input.requireAdmin && access.role !== "admin") {
    throw new OrganizationManagerError("Organization admin required", 403);
  }

  return access;
}

async function loadUsersById(
  executor: DatabaseSession,
  userIds: readonly string[],
): Promise<Map<string, UserKeyRow>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select({
      userId: users.id,
      signingKeyFingerprint: users.fingerprint,
      signingPublicKey: users.signingPublicKey,
      encapsulationPublicKey: users.encapsulationPublicKey,
      encapsulationKeyFingerprint: users.encapsulationKeyFingerprint,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(inArray(users.id, [...userIds]));

  return new Map(rows.map((row) => [row.userId, row]));
}

function toGroupSummary(input: {
  createdAt: Date;
  groupId: string;
  name: string;
  organizationId: string;
  state:
    | {
        stateHash: string;
        version: number;
        keyEpoch: number;
        memberCount: number;
      }
    | null
    | undefined;
}): OrganizationGroupSummaryResponse {
  return {
    groupId: input.groupId,
    organizationId: input.organizationId,
    name: input.name,
    createdAt: input.createdAt.toISOString(),
    currentState: input.state
      ? {
          stateHash: input.state.stateHash,
          version: input.state.version,
          keyEpoch: input.state.keyEpoch,
          memberCount: input.state.memberCount,
        }
      : null,
  };
}

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

export async function runListOrganizationDirectoryWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationDirectoryResponse> {
  return db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      userId: sessionUserId,
    });

    const projection = await listCurrentPrincipalProjectionMembers(
      "organization",
      organizationId,
      tx,
    );
    const directUserMembers = projection.filter(
      (entry) => entry.memberPrincipalType === "user",
    );
    const usersById = await loadUsersById(
      tx,
      directUserMembers.map((member) => member.memberPrincipalId),
    );

    return {
      organizationId,
      users: directUserMembers
        .flatMap((member) => {
          const user = usersById.get(member.memberPrincipalId);
          if (!user) {
            return [];
          }

          return [
            {
              userId: user.userId,
              signingKeyFingerprint: user.signingKeyFingerprint,
              signingPublicKey: user.signingPublicKey,
              encapsulationPublicKey: user.encapsulationPublicKey,
              encapsulationKeyFingerprint: user.encapsulationKeyFingerprint,
              role: member.role,
              createdAt: user.createdAt.toISOString(),
              isSelf: user.userId === sessionUserId,
            },
          ];
        })
        .sort((left, right) =>
          left.role === right.role
            ? left.userId.localeCompare(right.userId)
            : left.role === "admin"
              ? -1
              : 1,
        ),
    };
  });
}

export async function runListOrganizationGroupsWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
): Promise<ListOrganizationGroupsResponse> {
  return db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      userId: sessionUserId,
    });

    const groupRows = await tx
      .select({
        groupId: groups.id,
        organizationId: groups.organizationId,
        name: groups.name,
        createdAt: groups.createdAt,
      })
      .from(groups)
      .where(eq(groups.organizationId, organizationId))
      .orderBy(asc(groups.name), asc(groups.id));
    const currentStates = await getCurrentPrincipalStates(
      "group",
      groupRows.map((group) => group.groupId),
      tx,
    );

    return {
      organizationId,
      groups: groupRows.flatMap((group) => {
        if (!group.organizationId) {
          return [];
        }

        return [
          toGroupSummary({
            createdAt: group.createdAt,
            groupId: group.groupId,
            name: group.name,
            organizationId: group.organizationId,
            state: currentStates.get(group.groupId),
          }),
        ];
      }),
    };
  });
}

export async function runCreateOrganizationGroupWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  input: CreateOrganizationGroupRequest,
): Promise<OrganizationGroupSummaryResponse> {
  const name = input.name.trim();

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
      .insert(groups)
      .values({
        id: input.groupId,
        organizationId,
        name,
      })
      .onConflictDoNothing({ target: groups.id })
      .returning({
        groupId: groups.id,
        organizationId: groups.organizationId,
        name: groups.name,
        createdAt: groups.createdAt,
      });

    if (!insertedGroup?.organizationId) {
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
        name: insertedGroup.name,
        organizationId: insertedGroup.organizationId,
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

async function loadNestedGroupsById(input: {
  executor: DatabaseSession;
  groupMembers: ReadonlyArray<StoredPrincipalProjectionMember>;
  organizationId: string;
}): Promise<Map<string, NestedGroupRow>> {
  if (input.groupMembers.length === 0) {
    return new Map();
  }

  const rows = await input.executor
    .select({
      groupId: groups.id,
      groupName: groups.name,
    })
    .from(groups)
    .where(
      and(
        eq(groups.organizationId, input.organizationId),
        inArray(
          groups.id,
          input.groupMembers.map((member) => member.memberPrincipalId),
        ),
      ),
    );

  return new Map(rows.map((row) => [row.groupId, row]));
}

function toGroupMemberResponse(input: {
  groupsById: ReadonlyMap<string, NestedGroupRow>;
  member: StoredPrincipalProjectionMember;
  usersById: ReadonlyMap<string, UserKeyRow>;
}) {
  if (input.member.memberPrincipalType === "user") {
    const user = input.usersById.get(input.member.memberPrincipalId);

    return {
      memberPrincipalType: input.member.memberPrincipalType,
      memberPrincipalId: input.member.memberPrincipalId,
      role: input.member.role,
      userId: user?.userId ?? null,
      signingKeyFingerprint: user?.signingKeyFingerprint ?? null,
      signingPublicKey: user?.signingPublicKey ?? null,
      encapsulationPublicKey: user?.encapsulationPublicKey ?? null,
      encapsulationKeyFingerprint: user?.encapsulationKeyFingerprint ?? null,
      groupId: null,
      groupName: null,
    };
  }

  const nestedGroup = input.groupsById.get(input.member.memberPrincipalId);

  return {
    memberPrincipalType: input.member.memberPrincipalType,
    memberPrincipalId: input.member.memberPrincipalId,
    role: input.member.role,
    userId: null,
    signingKeyFingerprint: null,
    signingPublicKey: null,
    encapsulationPublicKey: null,
    encapsulationKeyFingerprint: null,
    groupId: nestedGroup?.groupId ?? null,
    groupName: nestedGroup?.groupName ?? null,
  };
}

async function listOrganizationGroupMembersInTransaction(input: {
  executor: DatabaseSession;
  groupId: string;
  organizationId: string;
  sessionUserId: string;
}): Promise<OrganizationGroupMembersResponse> {
  await requireDirectOrganizationAccess({
    executor: input.executor,
    organizationId: input.organizationId,
    userId: input.sessionUserId,
  });

  const [group] = await input.executor
    .select({
      groupId: groups.id,
    })
    .from(groups)
    .where(
      and(
        eq(groups.id, input.groupId),
        eq(groups.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  if (!group) {
    throw new OrganizationManagerError("Group not found", 404);
  }

  const currentState = await getCurrentPrincipalState(
    "group",
    input.groupId,
    input.executor,
  );
  if (!currentState) {
    throw new OrganizationManagerError("Group policy not found", 404);
  }

  const projection = await listCurrentPrincipalProjectionMembers(
    "group",
    input.groupId,
    input.executor,
  );
  const userMembers = projection.filter(
    (member) => member.memberPrincipalType === "user",
  );
  const groupMembers = projection.filter(
    (member) => member.memberPrincipalType === "group",
  );
  const usersById = await loadUsersById(
    input.executor,
    userMembers.map((member) => member.memberPrincipalId),
  );
  const groupsById = await loadNestedGroupsById({
    executor: input.executor,
    groupMembers,
    organizationId: input.organizationId,
  });

  return {
    organizationId: input.organizationId,
    groupId: input.groupId,
    members: projection.map((member) =>
      toGroupMemberResponse({
        groupsById,
        member,
        usersById,
      }),
    ),
  };
}

export async function runListOrganizationGroupMembersWorkflow(
  db: ApiDatabase,
  organizationId: string,
  groupId: string,
  sessionUserId: string,
): Promise<OrganizationGroupMembersResponse> {
  return db.transaction((tx) =>
    listOrganizationGroupMembersInTransaction({
      executor: tx,
      groupId,
      organizationId,
      sessionUserId,
    }),
  );
}

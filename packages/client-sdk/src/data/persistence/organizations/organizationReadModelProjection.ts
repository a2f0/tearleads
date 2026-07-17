import type {
  ListOrganizationGroupsResponse,
  OrganizationDirectoryResponse,
  OrganizationDirectoryUserResponse,
  OrganizationGroupCurrentStateResponse,
  OrganizationRosterStatus,
} from "@tearleads/validators/response";
import { and, asc, eq } from "drizzle-orm";
import {
  organizationReadModelDirectoryUsers,
  organizationReadModelGroups,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../sqlite/organizationReadModelSchema";
import type { ClientSQLiteTransaction } from "../../sqlite/sqlitePersistenceRuntime";

export type OrganizationDirectoryProjection = Omit<
  OrganizationDirectoryResponse,
  "currentUser"
>;

export interface OrganizationReadModelProjection {
  readonly cursor: string;
  readonly directory: OrganizationDirectoryProjection;
  readonly groups: ListOrganizationGroupsResponse;
  readonly organizationId: string;
  readonly protocolVersion: 1;
  readonly requester: OrganizationDirectoryResponse["currentUser"] | null;
  readonly updatedAt: string;
}

interface SelectedDirectoryUser {
  readonly createdAt: string;
  readonly disabledAt: string | null;
  readonly disabledByUserId: string | null;
  readonly encapsulationKeyFingerprint: string;
  readonly encapsulationPublicKey: string;
  readonly joinedAt: string;
  readonly profileDocumentId: string | null;
  readonly signingKeyFingerprint: string;
  readonly signingPublicKey: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly userId: string;
}

interface SelectedGroup {
  readonly createdAt: string;
  readonly groupId: string;
  readonly isBuiltin: boolean;
  readonly keyEpoch: number | null;
  readonly memberCount: number | null;
  readonly name: string;
  readonly stateHash: string | null;
  readonly stateVersion: number | null;
}

function isOrganizationRosterStatus(
  value: string,
): value is OrganizationRosterStatus {
  return value === "active" || value === "disabled";
}

function toDirectoryUser(
  row: SelectedDirectoryUser,
  currentUserId: string,
): OrganizationDirectoryUserResponse {
  if (!isOrganizationRosterStatus(row.status)) {
    throw new Error("Stored organization directory status is invalid");
  }

  return {
    userId: row.userId,
    signingKeyFingerprint: row.signingKeyFingerprint,
    signingPublicKey: row.signingPublicKey,
    encapsulationPublicKey: row.encapsulationPublicKey,
    encapsulationKeyFingerprint: row.encapsulationKeyFingerprint,
    createdAt: row.createdAt,
    isSelf: row.userId === currentUserId,
    status: row.status,
    profileDocumentId: row.profileDocumentId,
    joinedAt: row.joinedAt,
    updatedAt: row.updatedAt,
    disabledAt: row.disabledAt,
    disabledByUserId: row.disabledByUserId,
  };
}

function toGroupCurrentState(
  row: SelectedGroup,
): OrganizationGroupCurrentStateResponse | null {
  const values = [
    row.stateHash,
    row.stateVersion,
    row.keyEpoch,
    row.memberCount,
  ];
  if (values.every((value) => value === null)) {
    return null;
  }
  if (
    row.stateHash === null ||
    row.stateVersion === null ||
    row.keyEpoch === null ||
    row.memberCount === null ||
    row.stateHash.length === 0 ||
    !Number.isInteger(row.stateVersion) ||
    row.stateVersion <= 0 ||
    !Number.isInteger(row.keyEpoch) ||
    row.keyEpoch <= 0 ||
    !Number.isInteger(row.memberCount) ||
    row.memberCount < 0
  ) {
    throw new Error("Stored organization group state is invalid");
  }

  return {
    stateHash: row.stateHash,
    version: row.stateVersion,
    keyEpoch: row.keyEpoch,
    memberCount: row.memberCount,
  };
}

async function loadDirectoryRows(
  tx: ClientSQLiteTransaction,
  organizationId: string,
): Promise<SelectedDirectoryUser[]> {
  return tx
    .select({
      createdAt: organizationReadModelDirectoryUsers.createdAt,
      disabledAt: organizationReadModelDirectoryUsers.disabledAt,
      disabledByUserId: organizationReadModelDirectoryUsers.disabledByUserId,
      encapsulationKeyFingerprint:
        organizationReadModelDirectoryUsers.encapsulationKeyFingerprint,
      encapsulationPublicKey:
        organizationReadModelDirectoryUsers.encapsulationPublicKey,
      joinedAt: organizationReadModelDirectoryUsers.joinedAt,
      profileDocumentId: organizationReadModelDirectoryUsers.profileDocumentId,
      signingKeyFingerprint:
        organizationReadModelDirectoryUsers.signingKeyFingerprint,
      signingPublicKey: organizationReadModelDirectoryUsers.signingPublicKey,
      status: organizationReadModelDirectoryUsers.status,
      updatedAt: organizationReadModelDirectoryUsers.updatedAt,
      userId: organizationReadModelDirectoryUsers.userId,
    })
    .from(organizationReadModelDirectoryUsers)
    .where(
      eq(organizationReadModelDirectoryUsers.organizationId, organizationId),
    )
    .orderBy(
      asc(organizationReadModelDirectoryUsers.sortOrder),
      asc(organizationReadModelDirectoryUsers.userId),
    );
}

async function loadGroupRows(
  tx: ClientSQLiteTransaction,
  organizationId: string,
): Promise<SelectedGroup[]> {
  return tx
    .select({
      createdAt: organizationReadModelGroups.createdAt,
      groupId: organizationReadModelGroups.groupId,
      isBuiltin: organizationReadModelGroups.isBuiltin,
      keyEpoch: organizationReadModelGroups.keyEpoch,
      memberCount: organizationReadModelGroups.memberCount,
      name: organizationReadModelGroups.name,
      stateHash: organizationReadModelGroups.stateHash,
      stateVersion: organizationReadModelGroups.stateVersion,
    })
    .from(organizationReadModelGroups)
    .where(eq(organizationReadModelGroups.organizationId, organizationId))
    .orderBy(
      asc(organizationReadModelGroups.sortOrder),
      asc(organizationReadModelGroups.groupId),
    );
}

export async function loadOrganizationReadModelProjectionInTransaction(input: {
  readonly currentUserId: string;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransaction;
}): Promise<OrganizationReadModelProjection | null> {
  const [state] = await input.tx
    .select({
      cursor: organizationReadModelState.cursor,
      memberGroupId: organizationReadModelState.memberGroupId,
      profileDocumentId: organizationReadModelState.profileDocumentId,
      protocolVersion: organizationReadModelState.protocolVersion,
      updatedAt: organizationReadModelState.updatedAt,
    })
    .from(organizationReadModelState)
    .where(eq(organizationReadModelState.organizationId, input.organizationId))
    .limit(1);
  if (!state) {
    return null;
  }
  if (state.protocolVersion !== 1) {
    throw new Error("Stored organization read-model version is unsupported");
  }

  const [requester] = await input.tx
    .select({ isOrgAdmin: organizationReadModelRequesters.isOrgAdmin })
    .from(organizationReadModelRequesters)
    .where(
      and(
        eq(
          organizationReadModelRequesters.organizationId,
          input.organizationId,
        ),
        eq(organizationReadModelRequesters.userId, input.currentUserId),
      ),
    )
    .limit(1);
  const directoryRows = await loadDirectoryRows(input.tx, input.organizationId);
  const groupRows = await loadGroupRows(input.tx, input.organizationId);

  return {
    cursor: state.cursor,
    directory: {
      organizationId: input.organizationId,
      profileDocumentId: state.profileDocumentId,
      users: directoryRows.map((row) =>
        toDirectoryUser(row, input.currentUserId),
      ),
    },
    groups: {
      organizationId: input.organizationId,
      memberGroupId: state.memberGroupId,
      groups: groupRows.map((row) => ({
        groupId: row.groupId,
        organizationId: input.organizationId,
        name: row.name,
        createdAt: row.createdAt,
        isBuiltin: row.isBuiltin,
        currentState: toGroupCurrentState(row),
      })),
    },
    organizationId: input.organizationId,
    protocolVersion: 1,
    requester: requester ? { isOrgAdmin: requester.isOrgAdmin } : null,
    updatedAt: state.updatedAt,
  };
}

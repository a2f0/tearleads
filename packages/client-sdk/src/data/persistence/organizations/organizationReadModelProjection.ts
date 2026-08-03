import type {
  ListOrganizationGroupsResponse,
  OrganizationContainerGrantsResponse,
  OrganizationDirectoryResponse,
  OrganizationDirectoryUserResponse,
  OrganizationGroupCurrentStateResponse,
  OrganizationRosterStatus,
} from "@tearleads/validators/response";
import { and, asc, eq } from "drizzle-orm";
import {
  organizationReadModelDirectoryUsers,
  organizationReadModelGroupMembers,
  organizationReadModelGroups,
  organizationReadModelPolicyHeads,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../sqlite/organizationReadModelSchema";
import type { ClientSQLiteTransaction } from "../../sqlite/sqlitePersistenceRuntime";
import { loadOrganizationReadModelGrantsInTransaction } from "./organizationReadModelGrantPersistence";
import {
  ORGANIZATION_READ_MODEL_PROTOCOL_VERSION,
  OrganizationReadModelIntegrityError,
} from "./organizationReadModelProtocol";

export type OrganizationDirectoryProjection = Omit<
  OrganizationDirectoryResponse,
  "currentUser"
>;

export interface OrganizationReadModelProjection {
  readonly cursor: string;
  readonly directory: OrganizationDirectoryProjection;
  readonly grants: OrganizationContainerGrantsResponse;
  readonly groups: ListOrganizationGroupsResponse;
  readonly membershipEdges: OrganizationReadModelMembershipEdge[];
  readonly organizationId: string;
  readonly policyHeads: readonly OrganizationReadModelPolicyHead[];
  readonly protocolVersion: typeof ORGANIZATION_READ_MODEL_PROTOCOL_VERSION;
  readonly requester: OrganizationDirectoryResponse["currentUser"] | null;
  readonly updatedAt: string;
}

export interface OrganizationReadModelPolicyHead {
  readonly keyEpoch: number;
  readonly keyFingerprint: string;
  readonly memberCount: number;
  readonly organizationId: string;
  readonly principalId: string;
  readonly principalType: "group" | "organization";
  readonly stateHash: string;
  readonly version: number;
}

export interface OrganizationReadModelMembershipEdge {
  readonly groupId: string;
  readonly userId: string;
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

interface SelectedPolicyHead {
  readonly keyEpoch: number;
  readonly keyFingerprint: string;
  readonly memberCount: number;
  readonly organizationId: string;
  readonly principalId: string;
  readonly principalType: string;
  readonly stateHash: string;
  readonly stateVersion: number;
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
    throw new OrganizationReadModelIntegrityError(
      "Stored organization directory status is invalid",
    );
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
  policyHead: OrganizationReadModelPolicyHead | undefined,
): OrganizationGroupCurrentStateResponse | null {
  const values = [
    row.stateHash,
    row.stateVersion,
    row.keyEpoch,
    row.memberCount,
  ];
  if (values.every((value) => value === null)) {
    if (policyHead) {
      throw new OrganizationReadModelIntegrityError(
        "Stored organization group policy head is orphaned",
      );
    }
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
    row.memberCount < 0 ||
    !policyHead ||
    policyHead.stateHash !== row.stateHash ||
    policyHead.version !== row.stateVersion ||
    policyHead.keyEpoch !== row.keyEpoch ||
    policyHead.memberCount !== row.memberCount
  ) {
    throw new OrganizationReadModelIntegrityError(
      "Stored organization group state is invalid",
    );
  }

  return {
    stateHash: row.stateHash,
    version: row.stateVersion,
    keyEpoch: row.keyEpoch,
    keyFingerprint: policyHead.keyFingerprint,
    memberCount: row.memberCount,
  };
}

function toPolicyHead(
  row: SelectedPolicyHead,
): OrganizationReadModelPolicyHead {
  if (
    (row.principalType !== "group" && row.principalType !== "organization") ||
    row.principalId.length === 0 ||
    row.stateHash.length === 0 ||
    !Number.isInteger(row.stateVersion) ||
    row.stateVersion <= 0 ||
    !Number.isInteger(row.keyEpoch) ||
    row.keyEpoch <= 0 ||
    row.keyFingerprint.length === 0 ||
    !Number.isInteger(row.memberCount) ||
    row.memberCount < 0
  ) {
    throw new OrganizationReadModelIntegrityError(
      "Stored organization policy head is invalid",
    );
  }

  return {
    organizationId: row.organizationId,
    principalType: row.principalType,
    principalId: row.principalId,
    stateHash: row.stateHash,
    version: row.stateVersion,
    keyEpoch: row.keyEpoch,
    keyFingerprint: row.keyFingerprint,
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

async function loadPolicyHeadRows(
  tx: ClientSQLiteTransaction,
  organizationId: string,
): Promise<SelectedPolicyHead[]> {
  return tx
    .select({
      keyEpoch: organizationReadModelPolicyHeads.keyEpoch,
      keyFingerprint: organizationReadModelPolicyHeads.keyFingerprint,
      memberCount: organizationReadModelPolicyHeads.memberCount,
      organizationId: organizationReadModelPolicyHeads.organizationId,
      principalId: organizationReadModelPolicyHeads.principalId,
      principalType: organizationReadModelPolicyHeads.principalType,
      stateHash: organizationReadModelPolicyHeads.stateHash,
      stateVersion: organizationReadModelPolicyHeads.stateVersion,
    })
    .from(organizationReadModelPolicyHeads)
    .where(eq(organizationReadModelPolicyHeads.organizationId, organizationId))
    .orderBy(
      asc(organizationReadModelPolicyHeads.principalType),
      asc(organizationReadModelPolicyHeads.principalId),
    );
}

async function loadMembershipEdges(
  tx: ClientSQLiteTransaction,
  organizationId: string,
): Promise<OrganizationReadModelMembershipEdge[]> {
  return tx
    .select({
      groupId: organizationReadModelGroupMembers.groupId,
      userId: organizationReadModelGroupMembers.userId,
      memberPrincipalType: organizationReadModelGroupMembers.userId,
    })
    .from(organizationReadModelGroupMembers)
    .where(eq(organizationReadModelGroupMembers.organizationId, organizationId))
    .orderBy(
      asc(organizationReadModelGroupMembers.groupId),
      asc(organizationReadModelGroupMembers.sortOrder),
      asc(organizationReadModelGroupMembers.userId),
      asc(organizationReadModelGroupMembers.userId),
    );
}

function validatePolicyHeads(input: {
  readonly groupRows: readonly SelectedGroup[];
  readonly organizationId: string;
  readonly policyHeadRows: readonly SelectedPolicyHead[];
}): {
  readonly groupPolicyHeads: ReadonlyMap<
    string,
    OrganizationReadModelPolicyHead
  >;
  readonly policyHeads: readonly OrganizationReadModelPolicyHead[];
} {
  const policyHeads = input.policyHeadRows.map(toPolicyHead);
  const organizationPolicyHeads = policyHeads.filter(
    (head) => head.principalType === "organization",
  );
  if (
    organizationPolicyHeads.length !== 1 ||
    organizationPolicyHeads[0]?.principalId !== input.organizationId
  ) {
    throw new OrganizationReadModelIntegrityError(
      "Stored organization policy head is missing or ambiguous",
    );
  }
  const groupPolicyHeads = new Map(
    policyHeads
      .filter((head) => head.principalType === "group")
      .map((head) => [head.principalId, head]),
  );
  const visibleGroupIds = new Set(input.groupRows.map((row) => row.groupId));
  if (
    [...groupPolicyHeads.keys()].some(
      (principalId) => !visibleGroupIds.has(principalId),
    )
  ) {
    throw new OrganizationReadModelIntegrityError(
      "Stored organization group policy head is not visible",
    );
  }
  return { groupPolicyHeads, policyHeads };
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
      updatedAt: organizationReadModelState.updatedAt,
    })
    .from(organizationReadModelState)
    .where(eq(organizationReadModelState.organizationId, input.organizationId))
    .limit(1);
  if (!state) {
    return null;
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
  const grants = await loadOrganizationReadModelGrantsInTransaction(input);
  const membershipEdges = await loadMembershipEdges(
    input.tx,
    input.organizationId,
  );
  const policyHeadRows = await loadPolicyHeadRows(
    input.tx,
    input.organizationId,
  );
  const { groupPolicyHeads, policyHeads } = validatePolicyHeads({
    groupRows,
    organizationId: input.organizationId,
    policyHeadRows,
  });

  return {
    cursor: state.cursor,
    directory: {
      organizationId: input.organizationId,
      profileDocumentId: state.profileDocumentId,
      users: directoryRows.map((row) =>
        toDirectoryUser(row, input.currentUserId),
      ),
    },
    grants,
    groups: {
      organizationId: input.organizationId,
      memberGroupId: state.memberGroupId,
      groups: groupRows.map((row) => ({
        groupId: row.groupId,
        organizationId: input.organizationId,
        name: row.name,
        createdAt: row.createdAt,
        isBuiltin: row.isBuiltin,
        currentState: toGroupCurrentState(
          row,
          groupPolicyHeads.get(row.groupId),
        ),
      })),
    },
    membershipEdges,
    organizationId: input.organizationId,
    policyHeads,
    protocolVersion: ORGANIZATION_READ_MODEL_PROTOCOL_VERSION,
    requester: requester ? { isOrgAdmin: requester.isOrgAdmin } : null,
    updatedAt: state.updatedAt,
  };
}

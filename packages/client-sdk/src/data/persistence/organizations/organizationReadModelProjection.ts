import { compareCanonicalStrings } from "@tearleads/crypto";
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
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../sqlite/schema/organizationReadModelSchema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
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
  readonly groups: Omit<ListOrganizationGroupsResponse, "groups"> & {
    groups: Array<
      ListOrganizationGroupsResponse["groups"][number] & { name: string }
    >;
  };
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
  readonly isPersonalOrganizationOwner: boolean;
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
  readonly keyFingerprint: string | null;
  readonly memberCount: number | null;
  readonly name: string;
  readonly stateHash: string | null;
  readonly stateVersion: number | null;
}

/** A stored policy head before validation; `version` is the state version. */
interface StoredPolicyHead {
  readonly keyEpoch: number;
  readonly keyFingerprint: string;
  readonly memberCount: number;
  readonly stateHash: string;
  readonly version: number;
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
    isPersonalOrganizationOwner: row.isPersonalOrganizationOwner,
    isSelf: row.userId === currentUserId,
    status: row.status,
    profileDocumentId: row.profileDocumentId,
    joinedAt: row.joinedAt,
    updatedAt: row.updatedAt,
    disabledAt: row.disabledAt,
    disabledByUserId: row.disabledByUserId,
  };
}

function isValidPolicyHead(head: StoredPolicyHead): boolean {
  return (
    head.stateHash.length > 0 &&
    Number.isInteger(head.version) &&
    head.version > 0 &&
    Number.isSafeInteger(head.keyEpoch) &&
    head.keyEpoch > 0 &&
    head.keyFingerprint.length > 0 &&
    Number.isInteger(head.memberCount) &&
    head.memberCount >= 0
  );
}

/** A group's state columns are all null (stateless) or one valid head. */
function toGroupCurrentState(
  row: SelectedGroup,
): OrganizationGroupCurrentStateResponse | null {
  const values = [
    row.stateHash,
    row.stateVersion,
    row.keyEpoch,
    row.keyFingerprint,
    row.memberCount,
  ];
  if (values.every((value) => value === null)) {
    return null;
  }
  const head =
    row.stateHash === null ||
    row.stateVersion === null ||
    row.keyEpoch === null ||
    row.keyFingerprint === null ||
    row.memberCount === null
      ? null
      : {
          stateHash: row.stateHash,
          version: row.stateVersion,
          keyEpoch: row.keyEpoch,
          keyFingerprint: row.keyFingerprint,
          memberCount: row.memberCount,
        };
  if (!head || !isValidPolicyHead(head)) {
    throw new OrganizationReadModelIntegrityError(
      "Stored organization group state is invalid",
    );
  }
  return head;
}

function toOrganizationPolicyHead(
  organizationId: string,
  head: StoredPolicyHead,
): OrganizationReadModelPolicyHead {
  if (!isValidPolicyHead(head)) {
    throw new OrganizationReadModelIntegrityError(
      "Stored organization policy head is invalid",
    );
  }
  return {
    ...head,
    organizationId,
    principalId: organizationId,
    principalType: "organization",
  };
}

/** The organization head from the state row plus every stateful group head. */
function toProjectionPolicyHeads(input: {
  readonly groups: ReadonlyArray<{
    readonly currentState: OrganizationGroupCurrentStateResponse | null;
    readonly groupId: string;
  }>;
  readonly organizationHead: StoredPolicyHead;
  readonly organizationId: string;
}): OrganizationReadModelPolicyHead[] {
  const groupHeads = input.groups
    .flatMap((group): OrganizationReadModelPolicyHead[] =>
      group.currentState
        ? [
            {
              ...group.currentState,
              organizationId: input.organizationId,
              principalId: group.groupId,
              principalType: "group",
            },
          ]
        : [],
    )
    .sort((left, right) =>
      compareCanonicalStrings(left.principalId, right.principalId),
    );
  // Group heads precede the organization head, ordered by principal ID.
  return [
    ...groupHeads,
    toOrganizationPolicyHead(input.organizationId, input.organizationHead),
  ];
}

async function loadDirectoryRows(
  tx: ClientSQLiteTransactionScope,
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
      isPersonalOrganizationOwner:
        organizationReadModelDirectoryUsers.isPersonalOrganizationOwner,
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
  tx: ClientSQLiteTransactionScope,
  organizationId: string,
): Promise<SelectedGroup[]> {
  return tx
    .select({
      createdAt: organizationReadModelGroups.createdAt,
      groupId: organizationReadModelGroups.groupId,
      isBuiltin: organizationReadModelGroups.isBuiltin,
      keyEpoch: organizationReadModelGroups.keyEpoch,
      keyFingerprint: organizationReadModelGroups.keyFingerprint,
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

async function loadMembershipEdges(
  tx: ClientSQLiteTransactionScope,
  organizationId: string,
): Promise<OrganizationReadModelMembershipEdge[]> {
  return tx
    .select({
      groupId: organizationReadModelGroupMembers.groupId,
      userId: organizationReadModelGroupMembers.userId,
    })
    .from(organizationReadModelGroupMembers)
    .where(eq(organizationReadModelGroupMembers.organizationId, organizationId))
    .orderBy(
      asc(organizationReadModelGroupMembers.groupId),
      asc(organizationReadModelGroupMembers.sortOrder),
      asc(organizationReadModelGroupMembers.userId),
    );
}

export async function loadOrganizationReadModelProjectionInTransaction(input: {
  readonly currentUserId: string;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<OrganizationReadModelProjection | null> {
  const [state] = await input.tx
    .select({
      cursor: organizationReadModelState.cursor,
      memberGroupId: organizationReadModelState.memberGroupId,
      organizationKeyEpoch: organizationReadModelState.organizationKeyEpoch,
      organizationKeyFingerprint:
        organizationReadModelState.organizationKeyFingerprint,
      organizationMemberCount:
        organizationReadModelState.organizationMemberCount,
      organizationStateHash: organizationReadModelState.organizationStateHash,
      organizationStateVersion:
        organizationReadModelState.organizationStateVersion,
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
  const groups = groupRows.map((row) => ({
    groupId: row.groupId,
    organizationId: input.organizationId,
    name: row.name,
    createdAt: row.createdAt,
    isBuiltin: row.isBuiltin,
    currentState: toGroupCurrentState(row),
  }));
  const policyHeads = toProjectionPolicyHeads({
    groups,
    organizationHead: {
      keyEpoch: state.organizationKeyEpoch,
      keyFingerprint: state.organizationKeyFingerprint,
      memberCount: state.organizationMemberCount,
      stateHash: state.organizationStateHash,
      version: state.organizationStateVersion,
    },
    organizationId: input.organizationId,
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
      groups,
    },
    membershipEdges,
    organizationId: input.organizationId,
    policyHeads,
    protocolVersion: ORGANIZATION_READ_MODEL_PROTOCOL_VERSION,
    requester: requester ? { isOrgAdmin: requester.isOrgAdmin } : null,
    updatedAt: state.updatedAt,
  };
}

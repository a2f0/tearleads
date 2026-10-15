import type {
  ListOrganizationGroupsResponse,
  OrganizationGroupCurrentStateResponse,
  OrganizationReadModelDirectoryResponse,
  OrganizationReadModelResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { invalidatePrincipalRecovery } from "../../principals/principalRecoveryEpoch";
import { organizationDataUsageTables } from "../../sqlite/organizationDataUsageSchema";
import {
  organizationReadModelDirectoryUsers,
  organizationReadModelGroups,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../sqlite/organizationReadModelSchema";
import { organizationReadModelTables } from "../../sqlite/schema";
import { sqliteInsertBatchSize } from "../../sqlite/sqliteBindBudget";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { clearOrganizationPresentationDenialInTransaction } from "./organizationPresentationDenialPersistence";
import { applyOrganizationReadModelGrantsLane } from "./organizationReadModelGrantPersistence";
import {
  applyGroupMembershipsLane,
  assertStoredGroupMembershipBindings,
  OrganizationReadModelBindingError,
} from "./organizationReadModelMembershipPersistence";
import {
  loadOrganizationReadModelProjectionInTransaction,
  type OrganizationReadModelProjection,
} from "./organizationReadModelProjection";
import {
  loadWithOrganizationReadModelIntegrityPurge,
  pruneInactiveOrganizationRequestersInTransaction,
  purgeOrganizationReadModelProjectionInTransaction,
} from "./organizationReadModelPurge";
import { assertOrganizationReadModelResponse } from "./organizationReadModelResponseAssertions";

export type { OrganizationReadModelProjection } from "./organizationReadModelProjection";

const DIRECTORY_INSERT_BATCH_SIZE = sqliteInsertBatchSize(
  organizationReadModelDirectoryUsers,
);
const GROUP_INSERT_BATCH_SIZE = sqliteInsertBatchSize(
  organizationReadModelGroups,
);

type ApplyOrganizationReadModelResponseResult =
  | "already-applied"
  | "applied"
  | "stale";

interface CurrentOrganizationReadModelState {
  readonly cursor: string;
  readonly memberGroupId: string;
  readonly memberGroupStateHash: string;
  readonly organizationHead: OrganizationGroupCurrentStateResponse;
  readonly profileDocumentId: string | null;
}

async function replaceDirectoryLane(input: {
  readonly directory: OrganizationReadModelDirectoryResponse;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  await input.tx
    .delete(organizationReadModelDirectoryUsers)
    .where(
      eq(
        organizationReadModelDirectoryUsers.organizationId,
        input.organizationId,
      ),
    )
    .run();

  const rows = input.directory.users.map((user, sortOrder) => ({
    organizationId: input.organizationId,
    userId: user.userId,
    sortOrder,
    signingKeyFingerprint: user.signingKeyFingerprint,
    signingPublicKey: user.signingPublicKey,
    encapsulationPublicKey: user.encapsulationPublicKey,
    encapsulationKeyFingerprint: user.encapsulationKeyFingerprint,
    isPersonalOrganizationOwner: user.isPersonalOrganizationOwner,
    createdAt: user.createdAt,
    status: user.status,
    profileDocumentId: user.profileDocumentId,
    joinedAt: user.joinedAt,
    updatedAt: user.updatedAt,
    disabledAt: user.disabledAt,
    disabledByUserId: user.disabledByUserId,
  }));
  for (
    let index = 0;
    index < rows.length;
    index += DIRECTORY_INSERT_BATCH_SIZE
  ) {
    await input.tx
      .insert(organizationReadModelDirectoryUsers)
      .values(rows.slice(index, index + DIRECTORY_INSERT_BATCH_SIZE))
      .run();
  }
}

async function upsertRequester(input: {
  readonly currentUserId: string;
  readonly isOrgAdmin: boolean;
  readonly now: string;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const requesterRow = {
    organizationId: input.organizationId,
    userId: input.currentUserId,
    isOrgAdmin: input.isOrgAdmin,
    updatedAt: input.now,
  };
  await input.tx
    .insert(organizationReadModelRequesters)
    .values(requesterRow)
    .onConflictDoUpdate({
      target: [
        organizationReadModelRequesters.organizationId,
        organizationReadModelRequesters.userId,
      ],
      set: {
        isOrgAdmin: requesterRow.isOrgAdmin,
        updatedAt: requesterRow.updatedAt,
      },
    })
    .run();
  // Storing an authoritative response proves access: retire the durable
  // denial marker for this scope in the same transaction.
  await clearOrganizationPresentationDenialInTransaction({
    organizationId: input.organizationId,
    projection: "readModel",
    requesterUserId: input.currentUserId,
    tx: input.tx,
  });
}

async function replaceGroupsLane(input: {
  readonly groups: ListOrganizationGroupsResponse;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  // Hydrated names and delivered membership heads outlive a catalog
  // replacement; the groupMemberships lane rebinds any head that changed.
  const previousGroups = await input.tx
    .select({
      groupId: organizationReadModelGroups.groupId,
      membersStateHash: organizationReadModelGroups.membersStateHash,
      name: organizationReadModelGroups.name,
    })
    .from(organizationReadModelGroups)
    .where(
      eq(organizationReadModelGroups.organizationId, input.organizationId),
    );
  const previousById = new Map(
    previousGroups.map((group) => [group.groupId, group]),
  );
  await input.tx
    .delete(organizationReadModelGroups)
    .where(eq(organizationReadModelGroups.organizationId, input.organizationId))
    .run();

  const rows = input.groups.groups.map((group, sortOrder) => ({
    organizationId: input.organizationId,
    groupId: group.groupId,
    sortOrder,
    name: previousById.get(group.groupId)?.name ?? "",
    createdAt: group.createdAt,
    isBuiltin: group.isBuiltin,
    stateHash: group.currentState?.stateHash ?? null,
    stateVersion: group.currentState?.version ?? null,
    keyEpoch: group.currentState?.keyEpoch ?? null,
    keyFingerprint: group.currentState?.keyFingerprint ?? null,
    memberCount: group.currentState?.memberCount ?? null,
    membersStateHash: previousById.get(group.groupId)?.membersStateHash ?? null,
  }));
  for (let index = 0; index < rows.length; index += GROUP_INSERT_BATCH_SIZE) {
    await input.tx
      .insert(organizationReadModelGroups)
      .values(rows.slice(index, index + GROUP_INSERT_BATCH_SIZE))
      .run();
  }
}

async function loadCurrentState(
  tx: ClientSQLiteTransactionScope,
  organizationId: string,
): Promise<CurrentOrganizationReadModelState | null> {
  const [current] = await tx
    .select({
      cursor: organizationReadModelState.cursor,
      keyEpoch: organizationReadModelState.organizationKeyEpoch,
      keyFingerprint: organizationReadModelState.organizationKeyFingerprint,
      memberCount: organizationReadModelState.organizationMemberCount,
      memberGroupId: organizationReadModelState.memberGroupId,
      memberGroupStateHash: organizationReadModelState.memberGroupStateHash,
      profileDocumentId: organizationReadModelState.profileDocumentId,
      stateHash: organizationReadModelState.organizationStateHash,
      version: organizationReadModelState.organizationStateVersion,
    })
    .from(organizationReadModelState)
    .where(eq(organizationReadModelState.organizationId, organizationId))
    .limit(1);
  if (!current) {
    return null;
  }
  const { keyEpoch, keyFingerprint, memberCount, stateHash, version, ...rest } =
    current;
  return {
    ...rest,
    organizationHead: {
      keyEpoch,
      keyFingerprint,
      memberCount,
      stateHash,
      version,
    },
  };
}

function resolveApplyDisposition(input: {
  readonly current: CurrentOrganizationReadModelState | null;
  readonly requestedCursor: string | null;
  readonly response: OrganizationReadModelResponse;
}): ApplyOrganizationReadModelResponseResult | null {
  const currentCursor = input.current?.cursor ?? null;
  if (currentCursor !== input.requestedCursor) {
    return currentCursor === input.response.nextCursor
      ? "already-applied"
      : "stale";
  }
  if (!input.current && input.response.mode !== "snapshot") {
    throw new Error("Organization read-model delta requires a local snapshot");
  }
  return null;
}

interface ResponseLanesInput {
  readonly current: CurrentOrganizationReadModelState | null;
  readonly memberGroupId: string;
  readonly response: OrganizationReadModelResponse;
  readonly tx: ClientSQLiteTransactionScope;
}

/** Apply every carried lane and return the reserved Members head. */
async function replaceResponseLanes(
  input: ResponseLanesInput,
): Promise<string | null> {
  const { organizationId } = input.response;
  const directory = input.response.lanes.directory;
  if (directory) {
    await replaceDirectoryLane({ directory, organizationId, tx: input.tx });
  }
  const groups = input.response.lanes.groups;
  if (groups) {
    await replaceGroupsLane({ groups, organizationId, tx: input.tx });
  }
  const groupMemberships = input.response.lanes.groupMemberships;
  const memberGroupStateHash = groupMemberships
    ? await applyGroupMembershipsLane({
        currentMemberGroupStateHash:
          input.current?.memberGroupStateHash ?? null,
        lane: groupMemberships,
        memberGroupId: input.memberGroupId,
        organizationId,
        replaceAll: input.response.mode === "snapshot",
        tx: input.tx,
      })
    : (input.current?.memberGroupStateHash ?? null);
  const grants = input.response.lanes.grants;
  if (grants) {
    await applyOrganizationReadModelGrantsLane({
      lane: grants,
      organizationId,
      tx: input.tx,
    });
  }
  return memberGroupStateHash;
}

async function applyResponseLanes(
  input: ResponseLanesInput & { readonly currentUserId: string },
): Promise<string | null> {
  const memberGroupStateHash = await replaceResponseLanes(input);
  // The directory lane is the authoritative roster, already persisted above:
  // requester rows for users it no longer lists as active fall with it.
  if (input.response.lanes.directory) {
    await pruneInactiveOrganizationRequestersInTransaction({
      organizationId: input.response.organizationId,
      retainUserId: input.currentUserId,
      tx: input.tx,
    });
  }
  if (input.response.lanes.groups || input.response.lanes.groupMemberships) {
    await assertStoredGroupMembershipBindings({
      memberGroupId: input.memberGroupId,
      memberGroupStateHash,
      organizationId: input.response.organizationId,
      tx: input.tx,
    });
  }
  return memberGroupStateHash;
}

/**
 * Write the cursor with the organization policy head and the reserved Members
 * head in one row, so a failure anywhere in the page rolls them back together.
 */
async function upsertOrganizationReadModelState(input: {
  readonly current: CurrentOrganizationReadModelState | null;
  readonly memberGroupId: string;
  readonly memberGroupStateHash: string | null;
  readonly now: string;
  readonly response: OrganizationReadModelResponse;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const organizationHead =
    input.response.lanes.organizationPolicy?.currentState ??
    input.current?.organizationHead;
  if (!organizationHead || input.memberGroupStateHash === null) {
    throw new OrganizationReadModelBindingError(
      "Organization read-model policy or Members head is missing",
    );
  }
  const directoryLane = input.response.lanes.directory;
  const values = {
    cursor: input.response.nextCursor,
    profileDocumentId:
      directoryLane !== undefined
        ? directoryLane.profileDocumentId
        : (input.current?.profileDocumentId ?? null),
    memberGroupId: input.memberGroupId,
    memberGroupStateHash: input.memberGroupStateHash,
    organizationStateHash: organizationHead.stateHash,
    organizationStateVersion: organizationHead.version,
    organizationKeyEpoch: organizationHead.keyEpoch,
    organizationKeyFingerprint: organizationHead.keyFingerprint,
    organizationMemberCount: organizationHead.memberCount,
    updatedAt: input.now,
  };
  await input.tx
    .insert(organizationReadModelState)
    .values({ ...values, organizationId: input.response.organizationId })
    .onConflictDoUpdate({
      target: organizationReadModelState.organizationId,
      set: values,
    })
    .run();
}

function requireMemberGroupId(input: {
  readonly current: CurrentOrganizationReadModelState | null;
  readonly response: OrganizationReadModelResponse;
}): string {
  const memberGroupId =
    input.response.lanes.groups?.memberGroupId ?? input.current?.memberGroupId;
  if (!memberGroupId) {
    throw new Error("Organization read-model member group is missing");
  }
  return memberGroupId;
}

export async function loadOrganizationReadModelProjection(
  execSql: ExecSql,
  organizationId: string,
  currentUserId: string,
): Promise<OrganizationReadModelProjection | null> {
  return loadWithOrganizationReadModelIntegrityPurge({
    execSql,
    organizationId,
    load: (tx) =>
      loadOrganizationReadModelProjectionInTransaction({
        currentUserId,
        organizationId,
        tx,
      }),
  });
}

export async function applyOrganizationReadModelResponse(input: {
  readonly currentUserId: string;
  readonly execSql: ExecSql;
  readonly requestedCursor: string | null;
  readonly response: OrganizationReadModelResponse;
}): Promise<ApplyOrganizationReadModelResponseResult> {
  assertOrganizationReadModelResponse({
    currentUserId: input.currentUserId,
    response: input.response,
  });
  // The requester prune below also retires pruned users' usage projections.
  await ensureSqlTables(input.execSql, [
    ...organizationReadModelTables,
    ...organizationDataUsageTables,
  ]);

  const disposition = await getClientSQLitePersistenceRuntime(
    input.execSql,
  ).transaction(
    async (tx): Promise<ApplyOrganizationReadModelResponseResult> => {
      const current = await loadCurrentState(tx, input.response.organizationId);
      const disposition = resolveApplyDisposition({
        current,
        requestedCursor: input.requestedCursor,
        response: input.response,
      });
      if (disposition === "stale") {
        return disposition;
      }
      const now = new Date().toISOString();
      await upsertRequester({
        currentUserId: input.currentUserId,
        isOrgAdmin: input.response.currentUser.isOrgAdmin,
        now,
        organizationId: input.response.organizationId,
        tx,
      });
      if (disposition === "already-applied") {
        return disposition;
      }
      const memberGroupId = requireMemberGroupId({
        current,
        response: input.response,
      });
      const memberGroupStateHash = await applyResponseLanes({
        current,
        currentUserId: input.currentUserId,
        memberGroupId,
        response: input.response,
        tx,
      });
      await upsertOrganizationReadModelState({
        current,
        memberGroupId,
        memberGroupStateHash,
        now,
        response: input.response,
        tx,
      });

      return "applied";
    },
  );
  // An applied change follows an organization hint or mutation; in-flight
  // operations recover the directory again instead of reusing their memo.
  if (disposition === "applied")
    invalidatePrincipalRecovery(input.execSql, input.response.organizationId);
  return disposition;
}

export async function purgeOrganizationReadModelProjection(
  execSql: ExecSql,
  organizationId: string,
  options: { readonly onlyRequesterUserId?: string } = {},
): Promise<void> {
  await ensureSqlTables(execSql, organizationReadModelTables);
  await getClientSQLitePersistenceRuntime(execSql).transaction(async (tx) => {
    await purgeOrganizationReadModelProjectionInTransaction({
      onlyRequesterUserId: options.onlyRequesterUserId,
      organizationId,
      tx,
    });
  });
}

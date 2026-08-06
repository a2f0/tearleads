import type {
  ListOrganizationGroupsResponse,
  OrganizationReadModelDirectoryResponse,
  OrganizationReadModelResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { organizationDataUsageTables } from "../../sqlite/organizationDataUsageSchema";
import {
  organizationReadModelDirectoryUsers,
  organizationReadModelGroups,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../sqlite/organizationReadModelSchema";
import { organizationReadModelTables } from "../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { clearOrganizationPresentationDenialInTransaction } from "./organizationPresentationDenialPersistence";
import { applyOrganizationReadModelGrantsLane } from "./organizationReadModelGrantPersistence";
import { notifyOrganizationReadModelInvalidated } from "./organizationReadModelInvalidation";
import {
  applyGroupMembershipsLane,
  assertStoredGroupMembershipBindings,
} from "./organizationReadModelMembershipPersistence";
import {
  applyOrganizationPolicyLane,
  replaceGroupPolicyHeads,
} from "./organizationReadModelPolicyHeadPersistence";
import {
  loadOrganizationReadModelProjectionInTransaction,
  type OrganizationReadModelProjection,
} from "./organizationReadModelProjection";
import { OrganizationReadModelIntegrityError } from "./organizationReadModelProtocol";
import {
  pruneInactiveOrganizationRequestersInTransaction,
  purgeOrganizationReadModelProjectionInTransaction,
} from "./organizationReadModelPurge";
import { assertOrganizationReadModelResponse } from "./organizationReadModelResponseAssertions";

export type { OrganizationReadModelProjection } from "./organizationReadModelProjection";

const DIRECTORY_INSERT_BATCH_SIZE = 64;
const GROUP_INSERT_BATCH_SIZE = 90;

type ApplyOrganizationReadModelResponseResult =
  | "already-applied"
  | "applied"
  | "stale";

interface CurrentOrganizationReadModelState {
  readonly cursor: string;
  readonly memberGroupId: string;
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

/** The directory lane is the authoritative roster: requester rows for users
 * it no longer lists as active must fall with it. */
async function pruneRequestersForDirectoryLane(input: {
  readonly currentUserId: string;
  readonly directory: OrganizationReadModelDirectoryResponse;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  await pruneInactiveOrganizationRequestersInTransaction({
    activeUserIds: input.directory.users
      .filter((user) => user.status === "active")
      .map((user) => user.userId),
    organizationId: input.organizationId,
    retainUserId: input.currentUserId,
    tx: input.tx,
  });
}

async function replaceGroupsLane(input: {
  readonly groups: ListOrganizationGroupsResponse;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  await input.tx
    .delete(organizationReadModelGroups)
    .where(eq(organizationReadModelGroups.organizationId, input.organizationId))
    .run();
  await replaceGroupPolicyHeads(input);

  const rows = input.groups.groups.map((group, sortOrder) => ({
    organizationId: input.organizationId,
    groupId: group.groupId,
    sortOrder,
    name: group.name,
    createdAt: group.createdAt,
    isBuiltin: group.isBuiltin,
    stateHash: group.currentState?.stateHash ?? null,
    stateVersion: group.currentState?.version ?? null,
    keyEpoch: group.currentState?.keyEpoch ?? null,
    memberCount: group.currentState?.memberCount ?? null,
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
      memberGroupId: organizationReadModelState.memberGroupId,
      profileDocumentId: organizationReadModelState.profileDocumentId,
    })
    .from(organizationReadModelState)
    .where(eq(organizationReadModelState.organizationId, organizationId))
    .limit(1);
  return current ?? null;
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

async function replaceResponseLanes(input: {
  readonly response: OrganizationReadModelResponse;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const directory = input.response.lanes.directory;
  if (directory) {
    await replaceDirectoryLane({
      directory,
      organizationId: input.response.organizationId,
      tx: input.tx,
    });
  }
  const groups = input.response.lanes.groups;
  if (groups) {
    await replaceGroupsLane({
      groups,
      organizationId: input.response.organizationId,
      tx: input.tx,
    });
  }
  const organizationPolicy = input.response.lanes.organizationPolicy;
  if (organizationPolicy) {
    await applyOrganizationPolicyLane({
      organizationId: input.response.organizationId,
      organizationPolicy,
      tx: input.tx,
    });
  }
  const groupMemberships = input.response.lanes.groupMemberships;
  if (groupMemberships) {
    await applyGroupMembershipsLane({
      lane: groupMemberships,
      organizationId: input.response.organizationId,
      replaceAll: input.response.mode === "snapshot",
      tx: input.tx,
    });
  }
  const grants = input.response.lanes.grants;
  if (grants) {
    await applyOrganizationReadModelGrantsLane({
      lane: grants,
      organizationId: input.response.organizationId,
      tx: input.tx,
    });
  }
}

async function applyResponseLanes(input: {
  readonly currentUserId: string;
  readonly memberGroupId: string;
  readonly response: OrganizationReadModelResponse;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  await replaceResponseLanes({ response: input.response, tx: input.tx });
  const directoryLane = input.response.lanes.directory;
  if (directoryLane) {
    await pruneRequestersForDirectoryLane({
      currentUserId: input.currentUserId,
      directory: directoryLane,
      organizationId: input.response.organizationId,
      tx: input.tx,
    });
  }
  if (input.response.lanes.groups || input.response.lanes.groupMemberships) {
    await assertStoredGroupMembershipBindings({
      memberGroupId: input.memberGroupId,
      organizationId: input.response.organizationId,
      tx: input.tx,
    });
  }
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
  await ensureSqlTables(execSql, organizationReadModelTables);
  let purgedInvalidRows = false;
  const projection = await getClientSQLitePersistenceRuntime(
    execSql,
  ).transaction(async (tx) => {
    try {
      return await loadOrganizationReadModelProjectionInTransaction({
        currentUserId,
        organizationId,
        tx,
      });
    } catch (error) {
      if (!(error instanceof OrganizationReadModelIntegrityError)) {
        throw error;
      }
      // The projection is a server-refetchable cache: purge the invalid rows
      // so the next reconcile requests a cursorless snapshot instead of every
      // read and repair pass failing on the same row.
      await purgeOrganizationReadModelProjectionInTransaction({
        organizationId,
        tx,
      });
      purgedInvalidRows = true;
      return null;
    }
  });
  if (purgedInvalidRows) {
    // Realtime consumers may hold a caught-up lease over rows that no longer
    // exist; the notification lets them drop it and refetch authoritatively.
    notifyOrganizationReadModelInvalidated(execSql, organizationId);
  }
  return projection;
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

  return getClientSQLitePersistenceRuntime(input.execSql).transaction(
    async (tx) => {
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
      await applyResponseLanes({
        currentUserId: input.currentUserId,
        memberGroupId,
        response: input.response,
        tx,
      });
      const directoryLane = input.response.lanes.directory;
      const stateRow = {
        organizationId: input.response.organizationId,
        cursor: input.response.nextCursor,
        profileDocumentId:
          directoryLane !== undefined
            ? directoryLane.profileDocumentId
            : (current?.profileDocumentId ?? null),
        memberGroupId,
        updatedAt: now,
      };
      await tx
        .insert(organizationReadModelState)
        .values(stateRow)
        .onConflictDoUpdate({
          target: organizationReadModelState.organizationId,
          set: {
            cursor: stateRow.cursor,
            profileDocumentId: stateRow.profileDocumentId,
            memberGroupId: stateRow.memberGroupId,
            updatedAt: stateRow.updatedAt,
          },
        })
        .run();

      return "applied";
    },
  );
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

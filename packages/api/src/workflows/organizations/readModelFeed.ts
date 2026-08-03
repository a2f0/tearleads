import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  type OrganizationReadModelLane,
  type OrganizationReadModelOperation,
  organizationReadModelChanges,
} from "@tearleads/api-shared/schema";
import type {
  ListOrganizationGroupsResponse,
  OrganizationDirectoryResponse,
  OrganizationReadModelDirectoryResponse,
  OrganizationReadModelGrantsResponse,
  OrganizationReadModelGroupMembershipsResponse,
  OrganizationReadModelOrganizationPolicyResponse,
  OrganizationReadModelResponse,
} from "@tearleads/validators/response";
import { and, asc, eq, gt } from "drizzle-orm";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { requireDirectOrganizationAccess } from "./access";
import { loadOrganizationDirectoryInTransaction } from "./directory";
import { listOrganizationContainerGrantResponsesInTransaction } from "./grants";
import { loadOrganizationGroupMembershipsInTransaction } from "./groupMemberships";
import { loadOrganizationGroupsInTransaction } from "./groups";
import { lockOrganizationReadModelHeadInTransaction } from "./readModelChanges";
import {
  decodeOrganizationReadModelCursor,
  encodeOrganizationReadModelCursor,
} from "./readModelCursor";
import { isOrganizationReadModelCursorRetained } from "./readModelRetention";

interface ReadModelChange {
  readonly entityId: string;
  readonly lane: OrganizationReadModelLane;
  readonly operation: OrganizationReadModelOperation;
}

async function listChanges(input: {
  readonly cursor: bigint;
  readonly organizationId: string;
  readonly tx: DatabaseTransaction;
}): Promise<ReadModelChange[]> {
  return input.tx
    .select({
      entityId: organizationReadModelChanges.entityId,
      lane: organizationReadModelChanges.lane,
      operation: organizationReadModelChanges.operation,
    })
    .from(organizationReadModelChanges)
    .where(
      and(
        eq(organizationReadModelChanges.organizationId, input.organizationId),
        gt(organizationReadModelChanges.cursor, input.cursor),
      ),
    )
    .orderBy(asc(organizationReadModelChanges.cursor));
}

function coalesceGroupMembershipChanges(
  changes: readonly ReadModelChange[],
): ReadonlyMap<string, OrganizationReadModelOperation> {
  const operationsByGroupId = new Map<string, OrganizationReadModelOperation>();
  for (const change of changes) {
    if (change.lane === "groupMemberships") {
      operationsByGroupId.set(change.entityId, change.operation);
    }
  }
  return operationsByGroupId;
}

function toReadModelDirectory(
  directory: OrganizationDirectoryResponse,
): OrganizationReadModelDirectoryResponse {
  return {
    organizationId: directory.organizationId,
    profileDocumentId: directory.profileDocumentId,
    users: directory.users,
  };
}

interface ReadModelResponseContext {
  readonly isOrgAdmin: boolean;
  readonly nextCursor: string;
  readonly organizationId: string;
  readonly sessionUserId: string;
  readonly tx: DatabaseTransaction;
}

interface ReadModelLanes {
  directory?: OrganizationReadModelDirectoryResponse;
  grants?: OrganizationReadModelGrantsResponse;
  groupMemberships?: OrganizationReadModelGroupMembershipsResponse;
  groups?: ListOrganizationGroupsResponse;
  organizationPolicy?: OrganizationReadModelOrganizationPolicyResponse;
}

async function loadGrantsLane(
  input: ReadModelResponseContext,
): Promise<OrganizationReadModelGrantsResponse> {
  return {
    organizationId: input.organizationId,
    grants: await listOrganizationContainerGrantResponsesInTransaction({
      executor: input.tx,
      organizationId: input.organizationId,
    }),
  };
}

async function loadDirectoryLane(
  input: ReadModelResponseContext,
): Promise<OrganizationReadModelDirectoryResponse> {
  return toReadModelDirectory(
    await loadOrganizationDirectoryInTransaction({
      executor: input.tx,
      isOrgAdmin: input.isOrgAdmin,
      organizationId: input.organizationId,
      sessionUserId: input.sessionUserId,
    }),
  );
}

async function loadOrganizationPolicyLane(
  input: ReadModelResponseContext,
): Promise<OrganizationReadModelOrganizationPolicyResponse> {
  const currentState = await getCurrentPrincipalState(
    "organization",
    input.organizationId,
    input.tx,
  );
  if (!currentState) {
    throw new Error("Organization policy state is missing");
  }

  return {
    organizationId: input.organizationId,
    currentState: {
      stateHash: currentState.stateHash,
      version: currentState.version,
      keyEpoch: currentState.keyEpoch,
      keyFingerprint: currentState.keyFingerprint,
      memberCount: currentState.memberCount,
    },
  };
}

async function loadSnapshotResponse(
  input: ReadModelResponseContext,
): Promise<OrganizationReadModelResponse> {
  const directory = await loadDirectoryLane(input);
  const grants = await loadGrantsLane(input);
  const groups = await loadOrganizationGroupsInTransaction({
    executor: input.tx,
    organizationId: input.organizationId,
  });
  const groupMemberships = await loadOrganizationGroupMembershipsInTransaction({
    executor: input.tx,
    organizationId: input.organizationId,
  });
  const organizationPolicy = await loadOrganizationPolicyLane(input);
  return {
    version: 5,
    mode: "snapshot",
    organizationId: input.organizationId,
    nextCursor: input.nextCursor,
    hasMore: false,
    currentUser: { isOrgAdmin: input.isOrgAdmin },
    lanes: {
      directory,
      grants,
      groupMemberships,
      groups,
      organizationPolicy,
    },
  };
}

async function loadGroupMembershipDelta(input: {
  readonly changes: readonly ReadModelChange[];
  readonly organizationId: string;
  readonly tx: DatabaseTransaction;
}): Promise<OrganizationReadModelGroupMembershipsResponse> {
  const membershipOperations = coalesceGroupMembershipChanges(input.changes);
  const deletedGroupIds = [...membershipOperations.entries()]
    .flatMap(([groupId, operation]) =>
      operation === "delete" ? [groupId] : [],
    )
    .sort();
  const currentGroupIds = [...membershipOperations.entries()]
    .flatMap(([groupId, operation]) =>
      operation === "delete" ? [] : [groupId],
    )
    .sort();
  return loadOrganizationGroupMembershipsInTransaction({
    deletedGroupIds,
    executor: input.tx,
    groupIds: currentGroupIds,
    organizationId: input.organizationId,
  });
}

async function loadDeltaResponse(
  input: ReadModelResponseContext,
  requestedCursor: bigint,
): Promise<OrganizationReadModelResponse> {
  const changes = await listChanges({
    cursor: requestedCursor,
    organizationId: input.organizationId,
    tx: input.tx,
  });
  const changedLanes = new Set(changes.map((change) => change.lane));
  const lanes: ReadModelLanes = {};
  if (changedLanes.has("directory")) {
    lanes.directory = await loadDirectoryLane(input);
  }
  if (changedLanes.has("groups")) {
    lanes.groups = await loadOrganizationGroupsInTransaction({
      executor: input.tx,
      organizationId: input.organizationId,
    });
  }
  if (changedLanes.has("grants")) {
    lanes.grants = await loadGrantsLane(input);
  }
  if (changedLanes.has("groupMemberships")) {
    lanes.groupMemberships = await loadGroupMembershipDelta({
      changes,
      organizationId: input.organizationId,
      tx: input.tx,
    });
  }
  if (changedLanes.has("organizationPolicy")) {
    lanes.organizationPolicy = await loadOrganizationPolicyLane(input);
  }
  return {
    version: 5,
    mode: "delta",
    organizationId: input.organizationId,
    nextCursor: input.nextCursor,
    hasMore: false,
    currentUser: { isOrgAdmin: input.isOrgAdmin },
    lanes,
  };
}

async function getReadModelInTransaction(input: {
  readonly encodedCursor: string | undefined;
  readonly organizationId: string;
  readonly sessionUserId: string;
  readonly tx: DatabaseTransaction;
}): Promise<OrganizationReadModelResponse> {
  const accessInput = {
    executor: input.tx,
    organizationId: input.organizationId,
    userId: input.sessionUserId,
  };
  await requireDirectOrganizationAccess(accessInput);
  const currentHead = await lockOrganizationReadModelHeadInTransaction(
    input.tx,
    input.organizationId,
  );
  if (currentHead === null) {
    throw new Error("Organization read-model cursor head is missing");
  }
  const access = await requireDirectOrganizationAccess(accessInput);
  const requestedCursor =
    input.encodedCursor === undefined
      ? null
      : decodeOrganizationReadModelCursor(
          input.encodedCursor,
          input.organizationId,
        );
  const context: ReadModelResponseContext = {
    isOrgAdmin: access.isOrgAdmin,
    nextCursor: encodeOrganizationReadModelCursor(
      input.organizationId,
      currentHead,
    ),
    organizationId: input.organizationId,
    sessionUserId: input.sessionUserId,
    tx: input.tx,
  };
  const requiresSnapshot =
    requestedCursor === null ||
    requestedCursor > currentHead ||
    !(await isOrganizationReadModelCursorRetained({
      currentCursor: currentHead,
      organizationId: input.organizationId,
      requestedCursor,
      tx: input.tx,
    }));
  return requiresSnapshot
    ? loadSnapshotResponse(context)
    : loadDeltaResponse(context, requestedCursor);
}

export async function runGetOrganizationReadModelWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  encodedCursor: string | undefined,
): Promise<OrganizationReadModelResponse> {
  return db.transaction((tx) =>
    getReadModelInTransaction({
      encodedCursor,
      organizationId,
      sessionUserId,
      tx,
    }),
  );
}

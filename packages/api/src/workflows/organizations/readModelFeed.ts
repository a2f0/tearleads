import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import type {
  ListOrganizationGroupsResponse,
  OrganizationDirectoryResponse,
  OrganizationReadModelDirectoryResponse,
  OrganizationReadModelGrantsResponse,
  OrganizationReadModelGroupMembershipsResponse,
  OrganizationReadModelOrganizationPolicyResponse,
  OrganizationReadModelResponse,
} from "@tearleads/validators/response";
import type { StoredPrincipalState } from "../../access/read/principalStateStore";
import {
  type OrganizationGroupIds,
  requireDirectOrganizationAccess,
  requireOrganizationAccessCandidate,
} from "./access";
import { loadOrganizationDirectoryInTransaction } from "./directory";
import { listOrganizationContainerGrantResponsesInTransaction } from "./grants";
import { loadOrganizationGroupMembershipsInTransaction } from "./groupMemberships";
import { loadOrganizationGroupsInTransaction } from "./groups";
import {
  lockOrganizationReadModelHeadInTransaction,
  type OrganizationReadModelHead,
} from "./readModelChanges";
import {
  decodeOrganizationReadModelCursor,
  encodeOrganizationReadModelCursor,
} from "./readModelCursor";

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
  readonly organization: OrganizationGroupIds;
  readonly organizationId: string;
  /**
   * The organization head access verified after the shared head lock. Every
   * organization policy write updates that head row in its transaction, so
   * this transaction cannot observe a newer state.
   */
  readonly organizationState: StoredPrincipalState;
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

function loadOrganizationPolicyLane(
  input: ReadModelResponseContext,
): OrganizationReadModelOrganizationPolicyResponse {
  const currentState = input.organizationState;
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
    organization: input.organization,
    organizationId: input.organizationId,
  });
  const groupMemberships = await loadOrganizationGroupMembershipsInTransaction({
    executor: input.tx,
    organizationId: input.organizationId,
  });
  const organizationPolicy = loadOrganizationPolicyLane(input);
  return {
    version: 6,
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

/**
 * Reload exactly the lanes stamped after the requested cursor. Whole lanes are
 * replaced; the membership lane carries only groups whose rows or tombstones
 * were stamped after it.
 */
async function loadDeltaResponse(
  input: ReadModelResponseContext,
  head: OrganizationReadModelHead,
  requestedCursor: bigint,
): Promise<OrganizationReadModelResponse> {
  const changed = (lane: keyof OrganizationReadModelHead["laneCursors"]) =>
    head.laneCursors[lane] > requestedCursor;
  const lanes: ReadModelLanes = {};
  if (changed("directory")) {
    lanes.directory = await loadDirectoryLane(input);
  }
  if (changed("groups")) {
    lanes.groups = await loadOrganizationGroupsInTransaction({
      executor: input.tx,
      organization: input.organization,
      organizationId: input.organizationId,
    });
  }
  if (changed("grants")) {
    lanes.grants = await loadGrantsLane(input);
  }
  if (changed("groupMemberships")) {
    lanes.groupMemberships =
      await loadOrganizationGroupMembershipsInTransaction({
        changedAfterCursor: requestedCursor,
        executor: input.tx,
        organizationId: input.organizationId,
      });
  }
  if (changed("organizationPolicy")) {
    lanes.organizationPolicy = loadOrganizationPolicyLane(input);
  }
  return {
    version: 6,
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
  // Screen before the shared head lock so a caller without organization access
  // never holds it; the verified check below is the authoritative decision.
  await requireOrganizationAccessCandidate(accessInput);
  const head = await lockOrganizationReadModelHeadInTransaction(
    input.tx,
    input.organizationId,
  );
  if (head === null) {
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
      head.cursor,
    ),
    organization: access.organization,
    organizationId: input.organizationId,
    organizationState: access.organizationState,
    sessionUserId: input.sessionUserId,
    tx: input.tx,
  };
  // A cursor ahead of the head cannot have come from this organization's
  // committed history, so the client resets from a snapshot.
  return requestedCursor === null || requestedCursor > head.cursor
    ? loadSnapshotResponse(context)
    : loadDeltaResponse(context, head, requestedCursor);
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

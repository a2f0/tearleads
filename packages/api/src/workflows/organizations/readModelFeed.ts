import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  type OrganizationReadModelLane,
  organizationReadModelChanges,
} from "@tearleads/api-shared/schema";
import type {
  ListOrganizationGroupsResponse,
  OrganizationDirectoryResponse,
  OrganizationReadModelDirectoryResponse,
  OrganizationReadModelResponse,
} from "@tearleads/validators/response";
import { and, eq, gt } from "drizzle-orm";
import { requireDirectOrganizationAccess } from "./access";
import { loadOrganizationDirectoryInTransaction } from "./directory";
import { loadOrganizationGroupsInTransaction } from "./groups";
import { lockOrganizationReadModelHeadInTransaction } from "./readModelChanges";
import {
  decodeOrganizationReadModelCursor,
  encodeOrganizationReadModelCursor,
} from "./readModelCursor";

async function listChangedLanes(input: {
  readonly cursor: bigint;
  readonly organizationId: string;
  readonly tx: DatabaseTransaction;
}): Promise<Set<OrganizationReadModelLane>> {
  const rows = await input.tx
    .select({ lane: organizationReadModelChanges.lane })
    .from(organizationReadModelChanges)
    .where(
      and(
        eq(organizationReadModelChanges.organizationId, input.organizationId),
        gt(organizationReadModelChanges.cursor, input.cursor),
      ),
    )
    .groupBy(organizationReadModelChanges.lane);

  return new Set(rows.map((row) => row.lane));
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

export async function runGetOrganizationReadModelWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  encodedCursor: string | undefined,
): Promise<OrganizationReadModelResponse> {
  return db.transaction(async (tx) => {
    const accessInput = {
      executor: tx,
      organizationId,
      userId: sessionUserId,
    };
    await requireDirectOrganizationAccess(accessInput);
    const lockedHead = await lockOrganizationReadModelHeadInTransaction(
      tx,
      organizationId,
    );
    if (lockedHead === null) {
      throw new Error("Organization read-model cursor head is missing");
    }
    const currentHead = lockedHead;
    const access = await requireDirectOrganizationAccess(accessInput);
    const requestedCursor =
      encodedCursor === undefined
        ? null
        : decodeOrganizationReadModelCursor(encodedCursor, organizationId);
    const nextCursor = encodeOrganizationReadModelCursor(
      organizationId,
      currentHead,
    );
    if (requestedCursor === null || requestedCursor > currentHead) {
      const directory = toReadModelDirectory(
        await loadOrganizationDirectoryInTransaction({
          executor: tx,
          isOrgAdmin: access.isOrgAdmin,
          organizationId,
          sessionUserId,
        }),
      );
      const groups = await loadOrganizationGroupsInTransaction({
        executor: tx,
        organizationId,
      });

      return {
        version: 1,
        mode: "snapshot",
        organizationId,
        nextCursor,
        hasMore: false,
        currentUser: { isOrgAdmin: access.isOrgAdmin },
        lanes: { directory, groups },
      };
    }

    const changedLanes = await listChangedLanes({
      cursor: requestedCursor,
      organizationId,
      tx,
    });
    const lanes: {
      directory?: OrganizationReadModelDirectoryResponse;
      groups?: ListOrganizationGroupsResponse;
    } = {};

    if (changedLanes.has("directory")) {
      lanes.directory = toReadModelDirectory(
        await loadOrganizationDirectoryInTransaction({
          executor: tx,
          isOrgAdmin: access.isOrgAdmin,
          organizationId,
          sessionUserId,
        }),
      );
    }
    if (changedLanes.has("groups")) {
      lanes.groups = await loadOrganizationGroupsInTransaction({
        executor: tx,
        organizationId,
      });
    }

    return {
      version: 1,
      mode: "delta",
      organizationId,
      nextCursor,
      hasMore: false,
      currentUser: { isOrgAdmin: access.isOrgAdmin },
      lanes,
    };
  });
}

import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  organizationRosterEntries,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { isValidOrganizationLeaveRequest } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type {
  OrganizationMembershipResponse,
  OrganizationMembershipsResponse,
} from "@tearleads/validators/response";
import type { OrganizationLeaveRequest } from "@tearleads/validators/util";
import { and, asc, eq } from "drizzle-orm";
import { OrganizationManagerError } from "./errors";
import { readStoredLeaveRequest } from "./leaveRequest";
import { assertLeaveRequestMembershipCurrent } from "./leaveRequestMembership";
import { listUsersReachableFromCurrentGroup } from "./principalReachability";
import {
  appendOrganizationReadModelChangeInTransaction,
  lockOrganizationReadModelHeadForUpdateInTransaction,
} from "./readModelChanges";

// A signed request is accepted only near the moment it was signed, so a
// withdrawn request cannot be filed again by replaying its old signature.
const LEAVE_REQUEST_MAX_SKEW_MS = 10 * 60 * 1000;

interface MembershipRow {
  readonly leaveRequest: string | null;
  readonly organizationId: string;
  readonly syncPausedAt: Date | null;
}

const membershipColumns = {
  leaveRequest: organizationRosterEntries.leaveRequest,
  organizationId: organizationRosterEntries.organizationId,
  syncPausedAt: organizationRosterEntries.syncPausedAt,
};

function activeEntryOf(organizationId: string, userId: string) {
  return and(
    eq(organizationRosterEntries.organizationId, organizationId),
    eq(organizationRosterEntries.userId, userId),
    eq(organizationRosterEntries.status, "active"),
  );
}

async function loadMemberUser(executor: DatabaseSession, userId: string) {
  const [user] = await executor
    .select({
      personalOrganizationId: users.defaultOrganizationId,
      signingPublicKey: users.signingPublicKey,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new OrganizationManagerError("Membership not found", 404);
  return user;
}

function toMembership(
  row: MembershipRow,
  personalOrganizationId: string | null,
): OrganizationMembershipResponse {
  return {
    isPersonalOrganizationOwner: row.organizationId === personalOrganizationId,
    leaveRequestedAt:
      readStoredLeaveRequest(row.leaveRequest)?.requestedAt ?? null,
    organizationId: row.organizationId,
    syncPaused: row.syncPausedAt !== null,
  };
}

/**
 * The session user's own conduit rows: one per organization whose roster lists
 * them as active. Reads only the user's rows, so it needs no organization role
 * and no billing entitlement.
 */
export async function runListOrganizationMembershipsWorkflow(
  db: ApiDatabase,
  userId: string,
): Promise<OrganizationMembershipsResponse> {
  const rows = await db
    .select({
      ...membershipColumns,
      personalOrganizationId: users.defaultOrganizationId,
    })
    .from(organizationRosterEntries)
    .innerJoin(users, eq(users.id, organizationRosterEntries.userId))
    .where(
      and(
        eq(organizationRosterEntries.userId, userId),
        eq(organizationRosterEntries.status, "active"),
      ),
    )
    .orderBy(asc(organizationRosterEntries.organizationId));
  return {
    memberships: rows.map((row) =>
      toMembership(row, row.personalOrganizationId),
    ),
  };
}

// Roster mutations lock the organization's read-model head before the roster
// row, so a leave request and a concurrent profile change cannot deadlock.
async function lockOrganizationHead(
  tx: DatabaseTransaction,
  organizationId: string,
): Promise<void> {
  if (
    !(await lockOrganizationReadModelHeadForUpdateInTransaction(
      tx,
      organizationId,
    ))
  ) {
    throw new OrganizationManagerError("Membership not found", 404);
  }
}

async function updateActiveMembership(
  tx: DatabaseTransaction,
  input: {
    readonly organizationId: string;
    readonly userId: string;
    readonly values: Partial<typeof organizationRosterEntries.$inferInsert>;
  },
): Promise<MembershipRow> {
  const [row] = await tx
    .update(organizationRosterEntries)
    .set({ ...input.values, updatedAt: new Date() })
    .where(activeEntryOf(input.organizationId, input.userId))
    .returning(membershipColumns);
  if (!row) throw new OrganizationManagerError("Membership not found", 404);
  return row;
}

/**
 * Records the session user's choice to pause or resume one organization's
 * content syncing to their devices. Pausing changes no grant, key, or policy:
 * each device applies it by no longer pulling that organization's containers.
 * A personal organization cannot be paused, because every device keeps its
 * owner's own root, Contacts, and Trash there.
 */
export async function runUpdateOrganizationMembershipWorkflow(
  db: ApiDatabase,
  input: {
    readonly organizationId: string;
    readonly syncPaused: boolean;
    readonly userId: string;
  },
): Promise<OrganizationMembershipResponse> {
  return db.transaction(async (tx) => {
    const { personalOrganizationId } = await loadMemberUser(tx, input.userId);
    if (input.syncPaused && input.organizationId === personalOrganizationId) {
      throw new OrganizationManagerError(
        "A personal organization cannot be paused",
        409,
      );
    }
    const row = await updateActiveMembership(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      values: { syncPausedAt: input.syncPaused ? new Date() : null },
    });
    return toMembership(row, personalOrganizationId);
  });
}

function assertLeaveRequestFor(
  request: OrganizationLeaveRequest,
  input: { organizationId: string; signingPublicKey: string; userId: string },
): void {
  if (
    request.organizationId !== input.organizationId ||
    request.userId !== input.userId
  ) {
    throw new OrganizationManagerError(
      "Leave request names another organization or member",
      400,
    );
  }
  if (
    Math.abs(Date.now() - Date.parse(request.requestedAt)) >
    LEAVE_REQUEST_MAX_SKEW_MS
  ) {
    throw new OrganizationManagerError("Leave request is not current", 400);
  }
  if (
    !isValidOrganizationLeaveRequest(
      request,
      base64ToBytes(input.signingPublicKey),
    )
  ) {
    throw new OrganizationManagerError(
      "Leave request signature is invalid",
      400,
    );
  }
}

// Removing the only administrator is refused, so a request no administrator
// but the requester could approve would only ever sit pending.
async function assertAnotherAdministrator(
  tx: DatabaseTransaction,
  organizationId: string,
  userId: string,
): Promise<void> {
  const [organization] = await tx
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) {
    throw new OrganizationManagerError("Membership not found", 404);
  }
  const administrators = await listUsersReachableFromCurrentGroup({
    executor: tx,
    groupId: organization.adminGroupId,
  });
  if (administrators.length === 1 && administrators[0] === userId) {
    throw new OrganizationManagerError(
      "Add another administrator before asking to leave",
      409,
    );
  }
}

/**
 * Files the session user's signed request to leave. The request authorizes
 * nothing: an administrator who verifies its signature and the member's
 * unbroken Members membership since the head it cites acts on it by signing
 * the member's removal, which clears it. It reaches administrators through the
 * organization read model's directory lane.
 */
export async function runRequestOrganizationLeaveWorkflow(
  db: ApiDatabase,
  input: {
    readonly organizationId: string;
    readonly request: OrganizationLeaveRequest;
    readonly userId: string;
  },
): Promise<OrganizationMembershipResponse> {
  return db.transaction(async (tx) => {
    const user = await loadMemberUser(tx, input.userId);
    if (input.organizationId === user.personalOrganizationId) {
      throw new OrganizationManagerError(
        "A personal organization cannot be left",
        409,
      );
    }
    assertLeaveRequestFor(input.request, {
      organizationId: input.organizationId,
      signingPublicKey: user.signingPublicKey,
      userId: input.userId,
    });
    await lockOrganizationHead(tx, input.organizationId);
    await assertAnotherAdministrator(tx, input.organizationId, input.userId);
    await assertLeaveRequestMembershipCurrent(tx, {
      membersHead: input.request.membersHead,
      organizationId: input.organizationId,
      userId: input.userId,
    });
    const row = await updateActiveMembership(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      values: { leaveRequest: JSON.stringify(input.request) },
    });
    await appendOrganizationReadModelChangeInTransaction(tx, {
      lanes: ["directory"],
      organizationId: input.organizationId,
    });
    return toMembership(row, user.personalOrganizationId);
  });
}

/** Withdraws the session user's pending leave request, if any. */
export async function runWithdrawOrganizationLeaveRequestWorkflow(
  db: ApiDatabase,
  input: { readonly organizationId: string; readonly userId: string },
): Promise<OrganizationMembershipResponse> {
  return db.transaction(async (tx) => {
    const user = await loadMemberUser(tx, input.userId);
    await lockOrganizationHead(tx, input.organizationId);
    const row = await updateActiveMembership(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      values: { leaveRequest: null },
    });
    await appendOrganizationReadModelChangeInTransaction(tx, {
      lanes: ["directory"],
      organizationId: input.organizationId,
    });
    return toMembership(row, user.personalOrganizationId);
  });
}

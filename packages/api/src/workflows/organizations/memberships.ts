import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import { organizationRosterEntries, users } from "@tearleads/api-shared/schema";
import type {
  OrganizationMembershipResponse,
  OrganizationMembershipsResponse,
} from "@tearleads/validators/response";
import { and, asc, eq } from "drizzle-orm";
import { OrganizationManagerError } from "./errors";

async function loadPersonalOrganizationId(
  executor: DatabaseSession,
  userId: string,
): Promise<string | null> {
  const [user] = await executor
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.defaultOrganizationId ?? null;
}

function toMembership(
  row: { organizationId: string; syncPausedAt: Date | null },
  personalOrganizationId: string | null,
): OrganizationMembershipResponse {
  return {
    isPersonalOrganizationOwner: row.organizationId === personalOrganizationId,
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
      organizationId: organizationRosterEntries.organizationId,
      personalOrganizationId: users.defaultOrganizationId,
      syncPausedAt: organizationRosterEntries.syncPausedAt,
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
    const personalOrganizationId = await loadPersonalOrganizationId(
      tx,
      input.userId,
    );
    if (input.syncPaused && input.organizationId === personalOrganizationId) {
      throw new OrganizationManagerError(
        "A personal organization cannot be paused",
        409,
      );
    }
    const now = new Date();
    const [row] = await tx
      .update(organizationRosterEntries)
      .set({
        syncPausedAt: input.syncPaused ? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(organizationRosterEntries.organizationId, input.organizationId),
          eq(organizationRosterEntries.userId, input.userId),
          eq(organizationRosterEntries.status, "active"),
        ),
      )
      .returning({
        organizationId: organizationRosterEntries.organizationId,
        syncPausedAt: organizationRosterEntries.syncPausedAt,
      });
    if (!row) {
      throw new OrganizationManagerError("Membership not found", 404);
    }
    return toMembership(row, personalOrganizationId);
  });
}

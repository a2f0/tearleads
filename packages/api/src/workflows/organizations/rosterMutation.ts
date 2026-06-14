import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { organizationRosterEntries } from "@tearleads/api-shared/schema";
import type { UpdateOrganizationRosterEntryRequest } from "@tearleads/validators/request";
import type { OrganizationDirectoryUserResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { requireDirectOrganizationAccess } from "./access";
import { OrganizationManagerError } from "./errors";
import {
  isOrganizationProfileDocument,
  loadOrganizationRosterEntry,
  toOrganizationDirectoryUser,
} from "./roster";
import { loadUsersById } from "./users";

export async function runUpdateOrganizationRosterEntryWorkflow(
  db: ApiDatabase,
  organizationId: string,
  userId: string,
  sessionUserId: string,
  input: UpdateOrganizationRosterEntryRequest,
): Promise<OrganizationDirectoryUserResponse> {
  return db.transaction(async (tx) => {
    const access = await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      userId: sessionUserId,
    });
    if (sessionUserId !== userId && !access.isOrgAdmin) {
      throw new OrganizationManagerError("Organization admin required", 403);
    }

    const currentEntry = await loadOrganizationRosterEntry({
      executor: tx,
      organizationId,
      userId,
    });
    if (!currentEntry) {
      throw new OrganizationManagerError("Roster entry not found", 404);
    }

    if (
      input.profileDocumentId &&
      !(await isOrganizationProfileDocument({
        executor: tx,
        organizationId,
        profileDocumentId: input.profileDocumentId,
      }))
    ) {
      throw new OrganizationManagerError(
        "Profile document is not in this organization",
        400,
      );
    }

    const [rosterEntry] = await tx
      .update(organizationRosterEntries)
      .set({
        profileDocumentId: input.profileDocumentId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationRosterEntries.organizationId, organizationId),
          eq(organizationRosterEntries.userId, userId),
        ),
      )
      .returning();
    if (!rosterEntry) {
      throw new OrganizationManagerError("Roster entry not found", 404);
    }

    const usersById = await loadUsersById(tx, [userId]);
    const user = usersById.get(userId);
    if (!user) {
      throw new OrganizationManagerError("User not found", 404);
    }

    return toOrganizationDirectoryUser({
      rosterEntry,
      sessionUserId,
      user,
    });
  });
}

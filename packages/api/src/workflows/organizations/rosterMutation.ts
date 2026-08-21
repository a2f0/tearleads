import type { ApiDatabase } from "@symcrypt/api-shared/postgres";
import { organizationRosterEntries } from "@symcrypt/api-shared/schema";
import type { UpdateOrganizationRosterEntryRequest } from "@symcrypt/validators/request";
import type { OrganizationDirectoryUserResponse } from "@symcrypt/validators/response";
import { and, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { assertOrganizationCanSync } from "../billing/organizationSyncEligibility";
import { OrganizationManagerError } from "./errors";
import { requireSerializedOrganizationMutationAccess } from "./mutationAccess";
import { appendOrganizationReadModelChangeInTransaction } from "./readModelChanges";
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
    await requireSerializedOrganizationMutationAccess({
      organizationId,
      requireAdmin: sessionUserId !== userId,
      tx,
      userId: sessionUserId,
    });
    await assertOrganizationCanSync(tx, organizationId, sessionUserId);

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

    const profileDocumentChanged =
      input.profileDocumentId === null
        ? isNotNull(organizationRosterEntries.profileDocumentId)
        : or(
            isNull(organizationRosterEntries.profileDocumentId),
            ne(
              organizationRosterEntries.profileDocumentId,
              input.profileDocumentId,
            ),
          );
    const [updatedRosterEntry] = await tx
      .update(organizationRosterEntries)
      .set({
        profileDocumentId: input.profileDocumentId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationRosterEntries.organizationId, organizationId),
          eq(organizationRosterEntries.userId, userId),
          profileDocumentChanged,
        ),
      )
      .returning();
    const rosterEntry =
      updatedRosterEntry ??
      (await loadOrganizationRosterEntry({
        executor: tx,
        organizationId,
        userId,
      }));
    if (!rosterEntry) {
      throw new OrganizationManagerError("Roster entry not found", 404);
    }
    if (updatedRosterEntry) {
      await appendOrganizationReadModelChangeInTransaction(tx, {
        organizationId,
        lane: "directory",
        entityId: userId,
        operation: "upsert",
      });
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

import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { organizationRosterEntries } from "@tearleads/api-shared/schema";
import type { UpdateOrganizationRosterEntryRequest } from "@tearleads/validators/request";
import type { OrganizationDirectoryUserResponse } from "@tearleads/validators/response";
import { and, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { assertOrganizationCanSync } from "../billing/organizationSyncEligibility";
import { OrganizationManagerError } from "./errors";
import { requireSerializedOrganizationMutationAccess } from "./mutationAccess";
import { appendOrganizationReadModelChangeInTransaction } from "./readModelChanges";
import {
  isOrganizationRosterProfileDocument,
  isOrganizationRosterProfileDocumentForUser,
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

    const profileDocumentIsValid =
      !input.profileDocumentId ||
      (sessionUserId === userId
        ? await isOrganizationRosterProfileDocumentForUser({
            executor: tx,
            organizationId,
            profileDocumentId: input.profileDocumentId,
            userId,
          })
        : await isOrganizationRosterProfileDocument({
            executor: tx,
            organizationId,
            profileDocumentId: input.profileDocumentId,
          }));
    if (!profileDocumentIsValid) {
      throw new OrganizationManagerError(
        "Profile document is not in this organization's roster profile container",
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

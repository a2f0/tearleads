import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { organizationRosterEntries } from "@tearleads/api-shared/schema";
import type { UpdateOrganizationRosterTwoFactorRequest } from "@tearleads/validators/request";
import type { OrganizationDirectoryUserResponse } from "@tearleads/validators/response";
import { and, eq, ne } from "drizzle-orm";
import { OrganizationManagerError } from "./errors";
import { requireSerializedOrganizationMutationAccess } from "./mutationAccess";
import { appendOrganizationReadModelChangeInTransaction } from "./readModelChanges";
import {
  loadOrganizationRosterEntry,
  toOrganizationDirectoryUser,
} from "./roster";
import { loadUsersById } from "./users";

export interface RosterTwoFactorUpdate {
  /** Whether the stored requirement changed; a repeat changes nothing. */
  readonly changed: boolean;
  readonly user: OrganizationDirectoryUserResponse;
}

/**
 * An administrator sets whether a roster member must sign in with two-factor
 * authentication. It is a security setting, so it does not wait on the
 * organization's sync billing the way content mutations do.
 */
export async function runUpdateOrganizationRosterTwoFactorWorkflow(
  db: ApiDatabase,
  organizationId: string,
  userId: string,
  sessionUserId: string,
  input: UpdateOrganizationRosterTwoFactorRequest,
): Promise<RosterTwoFactorUpdate> {
  return db.transaction(async (tx) => {
    await requireSerializedOrganizationMutationAccess({
      organizationId,
      requireAdmin: true,
      tx,
      userId: sessionUserId,
    });

    const [updatedRosterEntry] = await tx
      .update(organizationRosterEntries)
      .set({ twoFactorRequired: input.required, updatedAt: new Date() })
      .where(
        and(
          eq(organizationRosterEntries.organizationId, organizationId),
          eq(organizationRosterEntries.userId, userId),
          ne(organizationRosterEntries.twoFactorRequired, input.required),
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
        lanes: ["directory"],
      });
    }

    const user = (await loadUsersById(tx, [userId])).get(userId);
    if (!user) {
      throw new OrganizationManagerError("User not found", 404);
    }

    return {
      changed: updatedRosterEntry !== undefined,
      user: toOrganizationDirectoryUser({ rosterEntry, sessionUserId, user }),
    };
  });
}

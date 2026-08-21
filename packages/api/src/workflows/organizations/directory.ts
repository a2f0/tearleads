import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { organizations } from "@symcrypt/api-shared/schema";
import type { OrganizationDirectoryResponse } from "@symcrypt/validators/response";
import { eq } from "drizzle-orm";
import { OrganizationManagerError } from "./errors";
import {
  listOrganizationRosterEntries,
  toOrganizationDirectoryUser,
} from "./roster";
import { loadUsersById } from "./users";

type OrganizationDirectoryUser = OrganizationDirectoryResponse["users"][number];

function compareOrganizationDirectoryUsers(
  left: OrganizationDirectoryUser,
  right: OrganizationDirectoryUser,
): number {
  return left.userId.localeCompare(right.userId);
}

async function loadOrganizationProfileDocumentId(input: {
  executor: DatabaseSession;
  organizationId: string;
}): Promise<string | null> {
  const [organization] = await input.executor
    .select({
      profileDocumentId: organizations.profileDocumentId,
    })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);

  if (!organization) {
    throw new OrganizationManagerError("Organization not found", 404);
  }

  return organization.profileDocumentId;
}

export async function loadOrganizationDirectoryInTransaction(input: {
  readonly executor: DatabaseSession;
  readonly isOrgAdmin: boolean;
  readonly organizationId: string;
  readonly sessionUserId: string;
}): Promise<OrganizationDirectoryResponse> {
  const profileDocumentId = await loadOrganizationProfileDocumentId(input);
  const rosterEntries = await listOrganizationRosterEntries(input);
  const usersById = await loadUsersById(
    input.executor,
    rosterEntries.map((entry) => entry.userId),
  );

  return {
    organizationId: input.organizationId,
    profileDocumentId,
    currentUser: {
      isOrgAdmin: input.isOrgAdmin,
    },
    users: rosterEntries
      .flatMap((rosterEntry) => {
        const user = usersById.get(rosterEntry.userId);
        if (!user) {
          return [];
        }

        return [
          toOrganizationDirectoryUser({
            rosterEntry,
            sessionUserId: input.sessionUserId,
            user,
          }),
        ];
      })
      .sort(compareOrganizationDirectoryUsers),
  };
}

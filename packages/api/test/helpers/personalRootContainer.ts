import { db } from "@tearleads/api-shared/postgres";
import { containers, organizations, users } from "@tearleads/api-shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";

interface RootContainerFixture {
  readonly adminGroupId: string;
  readonly id: string;
  readonly organizationId: string;
}

export async function getRootContainerForUser(
  userId: string,
): Promise<RootContainerFixture> {
  const [user] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  invariant(user, "expected user row");

  const [rootContainer] = await db
    .select({
      id: containers.id,
      organizationId: containers.organizationId,
    })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, user.defaultOrganizationId),
        isNull(containers.parentId),
        isNull(containers.systemSlot),
      ),
    )
    .limit(1);

  invariant(rootContainer, "expected root container row");
  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, rootContainer.organizationId))
    .limit(1);
  invariant(organization, "expected registered organization");

  return { ...rootContainer, adminGroupId: organization.adminGroupId };
}

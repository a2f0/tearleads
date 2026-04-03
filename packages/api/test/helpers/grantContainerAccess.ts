import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { grantContainerAccess } from "../../src/access/containerAccess";
import { db } from "../../src/adapters/postgres";
import { containers, users } from "../../src/schema";

export async function grantRootContainerWriteAccessToUser(
  ownerUserId: string,
  subjectUserId: string,
): Promise<number> {
  const [owner] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, ownerUserId))
    .limit(1);
  invariant(owner, "expected owner user row");

  const [rootContainer] = await db
    .select({
      id: containers.id,
    })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, owner.defaultOrganizationId),
        isNull(containers.parentId),
      ),
    )
    .limit(1);
  invariant(rootContainer, "expected root container");

  return grantContainerAccess({
    containerId: rootContainer.id,
    subjectType: "user",
    subjectId: subjectUserId,
    accessLevel: "write",
  });
}

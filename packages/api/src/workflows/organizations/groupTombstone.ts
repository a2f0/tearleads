import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { organizationGroupTombstones } from "@symcrypt/api-shared/schema";
import { eq } from "drizzle-orm";

export async function wasOrganizationGroupDeleted(input: {
  readonly executor: DatabaseSession;
  readonly groupId: string;
}): Promise<boolean> {
  const [deleted] = await input.executor
    .select({ groupId: organizationGroupTombstones.groupId })
    .from(organizationGroupTombstones)
    .where(eq(organizationGroupTombstones.groupId, input.groupId))
    .limit(1);
  return deleted !== undefined;
}

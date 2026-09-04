import { db } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";

/** Sign the existing fixture group's actual label, just as the SDK does. */
export async function groupPolicyPayload(
  groupId: string,
  members: unknown,
  nameForNewGroup?: string,
): Promise<string> {
  const [group] = await db
    .select({ name: groups.name })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  const name = group?.name ?? nameForNewGroup;
  if (name === undefined) throw new Error("Expected a named test group");
  return Buffer.from(JSON.stringify({ name, members })).toString("base64");
}

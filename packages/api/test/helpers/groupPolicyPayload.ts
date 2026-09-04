import { db } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";

/** Sign the existing fixture group's actual label, just as the SDK does. */
export async function groupPolicyPayload(
  groupId: string,
  members: unknown,
): Promise<string> {
  const [group] = await db
    .select({ name: groups.name })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  // Creation and unknown-target tests sign before a group row exists.
  const name = group?.name ?? "Test group";
  return Buffer.from(JSON.stringify({ name, members })).toString("base64");
}

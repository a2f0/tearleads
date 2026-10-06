import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalPolicyCommits } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { deleteOrganizationRemoteRows } from "./organizationPurgeRows";

test("organization purge removes only its own compound policy receipts", async () => {
  const organizationId = crypto.randomUUID();
  const otherOrganizationId = crypto.randomUUID();
  for (const id of [organizationId, otherOrganizationId]) {
    await db.insert(principalPolicyCommits).values({
      requestHash: crypto.randomUUID(),
      organizationId: id,
      groupId: crypto.randomUUID(),
      requesterUserId: crypto.randomUUID(),
      responseJson: "{}",
    });
  }
  await db.transaction((executor) =>
    deleteOrganizationRemoteRows({
      executor,
      organizationId,
      now: new Date(),
      scope: { blobIds: [], containerIds: [], documentIds: [] },
    }),
  );
  expect(
    await db
      .select()
      .from(principalPolicyCommits)
      .where(eq(principalPolicyCommits.organizationId, organizationId)),
  ).toEqual([]);
  expect(
    await db
      .select()
      .from(principalPolicyCommits)
      .where(eq(principalPolicyCommits.organizationId, otherOrganizationId)),
  ).toHaveLength(1);
});

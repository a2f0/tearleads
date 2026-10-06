import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalDirectoryBindings,
  principalPolicyCommits,
} from "@tearleads/api-shared/schema";
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
  for (const id of [organizationId, otherOrganizationId])
    await db.insert(principalDirectoryBindings).values({
      organizationId: id,
      organizationVersion: 1,
      organizationStateHash: "test",
      groupId: crypto.randomUUID(),
      groupVersion: 1,
      groupStateHash: "test",
    });
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
      .from(principalDirectoryBindings)
      .where(eq(principalDirectoryBindings.organizationId, organizationId)),
  ).toEqual([]);
  expect(
    await db
      .select()
      .from(principalDirectoryBindings)
      .where(
        eq(principalDirectoryBindings.organizationId, otherOrganizationId),
      ),
  ).toHaveLength(1);
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

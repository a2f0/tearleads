import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { eq, sql } from "drizzle-orm";
import invariant from "invariant";
import { registerOrganization } from "../../../../../test/helpers/organizationPurge";
import {
  compareSyncTimestamps,
  syncItemTimestamp,
  syncTimestampExpression,
} from "../../../../services/containers/syncTimestamp";
import { touchContainers } from "./documentRows";

async function listedTimestamp(containerId: string): Promise<string> {
  const [row] = await db
    .select({ at: syncTimestampExpression(sql`${containers.updatedAt}`) })
    .from(containers)
    .where(eq(containers.id, containerId));
  invariant(row, "expected the container");
  // The millisecond form both listing endpoints send for an item.
  return syncItemTimestamp(row.at);
}

test("every container touch strictly advances the millisecond timestamp a listing sends", async () => {
  const organizationId = await registerOrganization();
  const [container] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.organizationId, organizationId))
    .limit(1);
  invariant(container, "expected a container");
  const before = await listedTimestamp(container.id);

  // The same instant as the stored value, as a write in the same millisecond.
  const sameInstant = new Date(before);
  await db.transaction((tx) =>
    touchContainers(tx, [container.id], sameInstant),
  );
  const afterSameInstant = await listedTimestamp(container.id);
  expect(compareSyncTimestamps(afterSameInstant, before)).toBeGreaterThan(0);

  // An instance whose clock trails the last writer's.
  const trailingClock = new Date(Date.parse(before) - 60_000);
  await db.transaction((tx) =>
    touchContainers(tx, [container.id], trailingClock),
  );
  expect(
    compareSyncTimestamps(
      await listedTimestamp(container.id),
      afterSameInstant,
    ),
  ).toBeGreaterThan(0);
});

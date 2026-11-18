import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containerSyncTombstones } from "@tearleads/api-shared/schema";
import type { SyncWatermark } from "@tearleads/validators/response";
import { sql } from "drizzle-orm";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { discoveryCursor } from "./discoveryCursor";
import { readDiscoveryKey } from "./discoverySnapshot";
import { listContainerDocumentLanes } from "./listContainerDocumentLanes";
import { listContainers } from "./listContainers";

test("rotating API processes resume the same database cursor and a lagging access probe must retry", async () => {
  const { registration } = await registerServiceUser();
  const { userId, organizationId, rootContainerId } = registration;
  const providers = ["previous", "next"].map((documentSyncCursorHmacKey) => ({
    ...createServiceTestRuntime(),
    documentSyncCursorHmacKey,
  }));
  const runtime = createServiceTestRuntime();
  const baseline = await listContainers(runtime, userId);
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  await db.insert(containerSyncTombstones).values(
    ids.map((containerId) => ({
      containerId,
      userId,
      organizationId,
      depth: 0,
      reason: "deleted" as const,
    })),
  );
  let watermark: SyncWatermark | null = baseline.nextWatermark;
  const discovered: string[] = [];
  for (let i = 0; i < 3; i++) {
    const runtime = providers[i % 2];
    if (!runtime) throw new Error("Missing API fixture");
    const page = await listContainers(runtime, userId, { limit: 1, watermark });
    discovered.push(
      ...page.items.map((row) => row.id),
      ...page.tombstones.map((row) => row.containerId),
    );
    watermark = page.nextWatermark;
  }
  expect(discovered).toEqual(ids);
  const probe = (cursor: SyncWatermark | null) => {
    if (!cursor) throw new Error("Expected a parent publication cursor");
    return listContainerDocumentLanes(runtime, userId, {
      afterParentPage: { parentId: null, watermark: cursor },
      lanes: [
        {
          containerId: crypto.randomUUID(),
          laneId: "absent",
          limit: 1,
          watermark: null,
        },
        {
          containerId: rootContainerId,
          laneId: "probe",
          limit: 1,
          watermark: null,
        },
      ],
    });
  };
  expect((await probe(watermark)).results).toContainEqual(
    expect.objectContaining({ laneId: "probe", page: expect.anything() }),
  );
  const key = await readDiscoveryKey(runtime);
  const cursor = discoveryCursor(key, [userId, "containers", null], null);
  const future = cursor.seal(
    {
      id: `1/${rootContainerId}`,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    "9223372036854775807",
  );
  await expect(probe(future)).rejects.toMatchObject({ status: 409 });
});

test("rotating the restored database key replays a cursor past a reused publication", async () => {
  const {
    registration: { userId, organizationId, rootContainerId },
  } = await registerServiceUser();
  await db.transaction(async (tx) => {
    const runtime = createServiceTestRuntime(tx);
    const beginning = await listContainers(runtime, userId);
    const insert = (containerId: string) =>
      tx.insert(containerSyncTombstones).values({
        containerId,
        userId,
        organizationId,
        depth: 0,
        reason: "deleted",
      });
    // Rewind rows, counter and key together, as in a point-in-time restore.
    // Immediate checks publish rows before each listing in this isolated transaction.
    await tx.execute(sql`savepoint before_restore`);
    await tx.execute(sql`set constraints all immediate`);
    await insert("ffffffff-ffff-4fff-bfff-ffffffffffff");
    const previous = await listContainers(runtime, userId, {
      watermark: beginning.nextWatermark,
    });
    if (!previous.nextWatermark)
      throw new Error("Missing pre-restore watermark");
    await tx.execute(sql`rollback to savepoint before_restore`);
    await tx.execute(sql`set constraints all immediate`);
    const replacement = "00000000-0000-4000-8000-000000000001";
    await insert(replacement);
    const resumed = { limit: 1, watermark: previous.nextWatermark };
    await tx.execute(sql`update drizzle.discovery_cursor_key
      set key_material = gen_random_uuid()::text || gen_random_uuid()::text where singleton`);
    const replay = await listContainers(runtime, userId, resumed);
    expect(replay.items.map((row) => row.id)).toEqual([rootContainerId]);
    expect(replay.hasMore).toBe(true);
    let page = replay;
    const removed: string[] = [];
    for (let i = 0; i <= beginning.items.length && page.hasMore; i++) {
      page = await listContainers(runtime, userId, {
        limit: 1,
        watermark: page.nextWatermark,
      });
      removed.push(...page.tombstones.map((row) => row.containerId));
    }
    expect(page.hasMore).toBe(false);
    expect(removed).toEqual([replacement]);
    await tx.execute(sql`rollback to savepoint before_restore`);
  });
});

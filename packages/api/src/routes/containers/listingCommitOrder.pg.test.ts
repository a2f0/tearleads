import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  containerSyncTombstones,
  containers,
} from "@tearleads/api-shared/schema";
import type { SyncWatermark } from "@tearleads/validators/response";
import { eq, sql } from "drizzle-orm";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { listContainerDocumentLanes } from "../../services/containers/listContainerDocumentLanes";
import { listContainerParentLanes } from "../../services/containers/listContainerParentLanes";

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a container lane resumes past a committed live row and finds an older-stamped late removal",
  async () => {
    const { registration } = await registerServiceUser();
    const runtime = createServiceTestRuntime();
    const list = async (watermark: SyncWatermark | null) => {
      const result = await listContainerParentLanes(
        runtime,
        registration.userId,
        {
          lanes: [{ laneId: "root", parentId: null, watermark }],
        },
      );
      const page = result.results[0]?.page;
      if (!page) throw new Error("Expected the root lane");
      return page;
    };
    const baseline = await list(null);
    const tombstoneId = crypto.randomUUID();
    const early = new Date(Date.now() + 1000);
    const late = new Date(early.getTime() + 1000);
    const writer = await holdPostgresLock(async (tx) => {
      await tx.insert(containerSyncTombstones).values({
        containerId: tombstoneId,
        userId: registration.userId,
        organizationId: registration.organizationId,
        depth: 0,
        reason: "deleted",
        updatedAt: early,
      });
      // The deferred publications must also handle several writes to the same row.
      await tx
        .update(containerSyncTombstones)
        .set({ updatedAt: early })
        .where(eq(containerSyncTombstones.containerId, tombstoneId));
    });
    let saved: SyncWatermark | null;
    try {
      await db
        .update(containers)
        .set({ updatedAt: late })
        .where(eq(containers.id, registration.rootContainerId));
      const middle = await list(baseline.nextWatermark);
      expect(middle.items.map((item) => item.id)).toEqual([
        registration.rootContainerId,
      ]);
      expect(middle.tombstones).toEqual([]);
      saved = middle.nextWatermark;
    } finally {
      await writer.release();
    }
    const resumed = await list(saved);
    expect(resumed.items).toEqual([]);
    expect(resumed.tombstones.map((row) => row.containerId)).toEqual([
      tombstoneId,
    ]);
    expect((await list(resumed.nextWatermark)).tombstones).toEqual([]);
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a second publisher waits until the transaction that allocated its predecessor commits",
  async () => {
    const { registration } = await registerServiceUser();
    const visible = async () =>
      (
        await db.execute<{ value: string }>(
          sql`select publication::text as value from drizzle.discovery_cursor_key where singleton`,
        )
      ).rows[0]?.value;
    const before = await visible();
    const first = await holdPostgresLock(async (tx) => {
      await tx.insert(containerSyncTombstones).values({
        containerId: crypto.randomUUID(),
        userId: registration.userId,
        organizationId: registration.organizationId,
        depth: 0,
        reason: "deleted",
      });
      await tx.execute(
        sql`set constraints publish_container_removal_discovery immediate`,
      );
    });
    expect(await visible()).toBe(before);
    const second = db.transaction(async (tx) => {
      await tx
        .update(containers)
        .set({ updatedAt: new Date() })
        .where(eq(containers.id, registration.rootContainerId));
      await tx.execute(
        sql`set constraints publish_container_discovery immediate`,
      );
    });
    try {
      await Promise.race([
        waitForPostgresLockWait({
          blockerPid: first.backendPid,
          queryFragment:
            "set constraints publish_container_discovery immediate",
        }),
        second.then(() => {
          throw new Error("Second publisher committed before its predecessor");
        }),
      ]);
    } finally {
      await first.release();
      await second;
    }
    expect(BigInt((await visible()) ?? "0")).toBeGreaterThan(
      BigInt(before ?? "0"),
    );
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a checkpointed permission probe keeps its snapshot across a concurrent publication",
  async () => {
    const {
      registration: { userId, rootContainerId },
    } = await registerServiceUser();
    const runtime = createServiceTestRuntime();
    const page = await listContainerParentLanes(runtime, userId, {
      lanes: [{ parentId: null, laneId: "root", watermark: null }],
    });
    const watermark = page.results[0]?.page?.nextWatermark;
    if (!watermark) throw new Error("Expected a parent checkpoint");
    let consistent = false;
    const transaction: typeof db.transaction = (run, config) =>
      db.transaction(async (tx) => {
        const position = async () =>
          (
            await tx.execute<{ value: string }>(
              sql`select publication::text as value from drizzle.discovery_cursor_key where singleton`,
            )
          ).rows[0]?.value;
        const before = await position();
        await db
          .update(containers)
          .set({ updatedAt: new Date() })
          .where(eq(containers.id, rootContainerId));
        const result = await run(tx);
        consistent = before === (await position());
        return result;
      }, config);
    const pinned = new Proxy(db, {
      get(target, property) {
        return property === "transaction"
          ? transaction
          : Reflect.get(target, property);
      },
    });
    const response = await listContainerDocumentLanes(
      createServiceTestRuntime(pinned),
      userId,
      {
        afterParentPage: { parentId: null, watermark },
        lanes: [
          {
            containerId: rootContainerId,
            laneId: "still-readable",
            limit: 1,
            watermark: null,
          },
        ],
      },
    );
    expect(response.results[0]).toMatchObject({
      laneId: "still-readable",
      page: expect.anything(),
    });
    expect(consistent).toBe(true);
  },
  30000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "an access probe must cover newer publications outside the first page",
  async () => {
    const {
      registration: { userId, organizationId, rootContainerId },
    } = await registerServiceUser();
    const primary = createServiceTestRuntime();
    await db.transaction(
      async (snapshot) => {
        // This real connection can see the first (root) row but cannot see
        // the second publication at the time the primary issues its page.
        await snapshot.execute(
          sql`select publication from drizzle.discovery_cursor_key`,
        );
        await db.insert(containerSyncTombstones).values({
          containerId: crypto.randomUUID(),
          userId,
          organizationId,
          depth: 0,
          reason: "deleted",
        });
        const listing = await listContainerParentLanes(primary, userId, {
          lanes: [
            { parentId: null, laneId: "first", limit: 1, watermark: null },
          ],
        });
        const page = listing.results[0]?.page;
        if (!page?.nextWatermark)
          throw new Error("Expected a publication cursor");
        expect(page.hasMore).toBe(true);
        expect(page.items[0]?.id).toBe(rootContainerId);
        const request = {
          afterParentPage: { parentId: null, watermark: page.nextWatermark },
          lanes: [
            {
              containerId: rootContainerId,
              laneId: "access",
              limit: 1,
              watermark: null,
            },
          ],
        };
        const behind = createServiceTestRuntime(snapshot);
        await expect(
          listContainerDocumentLanes(behind, userId, request),
        ).rejects.toMatchObject({ status: 409 });
        const visible = await listContainerDocumentLanes(
          primary,
          userId,
          request,
        );
        expect(visible.results[0]).toMatchObject({ page: expect.anything() });
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  },
  30000,
);

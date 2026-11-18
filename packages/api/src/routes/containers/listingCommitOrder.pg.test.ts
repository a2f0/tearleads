import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  containerSyncTombstones,
  containers,
} from "@tearleads/api-shared/schema";
import type { SyncWatermark } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { holdPostgresLock } from "../../../test/helpers/postgresConcurrency";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
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

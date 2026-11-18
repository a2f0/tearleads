import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containerSyncTombstones } from "@tearleads/api-shared/schema";
import type { SyncWatermark } from "@tearleads/validators/response";
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
          containerId: rootContainerId,
          laneId: "probe",
          limit: 1,
          watermark: null,
        },
      ],
    });
  };
  expect((await probe(watermark)).results[0]).toHaveProperty("page");
  const key = await readDiscoveryKey(runtime);
  const cursor = discoveryCursor(key, [userId, "containers", null], null);
  const future = cursor.seal(
    { id: `1/${rootContainerId}`, updatedAt: "2026-01-01T00:00:00.000Z" },
    "FFFFFFFF/FFFFFFFF",
  );
  await expect(probe(future)).rejects.toMatchObject({ status: 409 });
});

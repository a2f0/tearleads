import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { waitFor } from "../../../test/helpers/data/waitFor";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/workflows/internalRuntimeFixtures";
import {
  ContainerSyncWatermarkRepository,
  containerContentsSyncLane,
} from "../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { listOwedDocumentLaneContainerIds } from "../../workflows/container-contents/documentDiscovery/documentLaneDiscovery";
import type { ContainerContents } from "../containerContents";
import { createDeviceFirst, createDeviceFirstWorkflowRuntime } from "./index";

const AT = "2026-11-25T00:00:00.000Z";
const CONTAINER_IDS = ["root", "listed-folder", "cut-short-folder"] as const;

// Issue #3255: a reload cut the sign-in boot short after one batched listing
// named every lane but before the later lanes applied. The restarted device
// raises only the `hydrated` signal for its cached tree, and that must still
// list the lane the earlier boot left owed.
test("a restart lists the document lanes an earlier boot left owed", async () => {
  const { close, execSql } = await createTestExecSql(
    "device-first-owed-discovery",
  );
  const listedLanes: string[][] = [];
  const apiClient = createMockApiClient({
    listContainerDocumentLanes: async ({ lanes }) => {
      listedLanes.push(lanes.map((lane) => lane.containerId));
      return {
        results: lanes.map(({ laneId }) => ({
          laneId,
          page: {
            hasMore: false,
            items: [],
            nextWatermark: null,
            tombstones: [],
          },
        })),
      };
    },
  });
  const input = createWorkflowInputFixture({
    apiClient,
    auth: { isAuthenticated: true, organizationId: "org" },
    execSql,
    online: true,
  });
  const runtime = createInternalRuntimeFixture(() => input);
  const deviceFirst = createDeviceFirst(runtime, {} as ContainerContents);
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    for (const id of CONTAINER_IDS) {
      await defaultContainerContentsPersistence.saveContainer(
        execSql,
        {
          effectiveAccessLevel: "admin",
          icon: null,
          id,
          metadataDocumentId: `${id}-metadata`,
          name: id,
          organizationId: "org",
          parentId: id === "root" ? null : "root",
        },
        null,
      );
    }
    // The earlier boot applied the first two lanes; the reload landed while
    // the third was still verifying, so it recorded nothing for that lane.
    const watermarks = new ContainerSyncWatermarkRepository(execSql);
    for (const id of ["root", "listed-folder"]) {
      await watermarks.recordLaneFetch(containerContentsSyncLane(id), {
        checked: true,
        watermark: { id: `${id}-cursor`, updatedAt: AT },
      });
    }
    expect(
      await listOwedDocumentLaneContainerIds(execSql, CONTAINER_IDS),
    ).toEqual(["cut-short-folder"]);

    const { view } = deviceFirst.open();
    view.updateRuntime(createDeviceFirstWorkflowRuntime(runtime));
    await waitFor(() => view.getSnapshot().ready, "Local tree did not hydrate");
    await waitFor(
      () => listedLanes.length > 0,
      "The owed lane was never listed after the restart",
    );
    // Settled lanes stay lazy; only the owed one is listed.
    expect(listedLanes).toEqual([["cut-short-folder"]]);
    await waitFor(
      async () =>
        (await listOwedDocumentLaneContainerIds(execSql, CONTAINER_IDS))
          .length === 0,
      "The applied listing did not settle the lane",
    );
  } finally {
    deviceFirst.dispose();
    close();
  }
});

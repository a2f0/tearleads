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

interface Connection {
  readonly generation: number;
  readonly pendingAttempt?: number | undefined;
}

/**
 * Issue #3255: a reload cut the sign-in boot short after one batched listing
 * named every lane but before the later lanes applied. The restarted device
 * holds a cached tree, which raises no hint for a lane it already holds, and
 * its socket may never declare interest, so no acknowledged connection lists
 * the lanes either. Opens device-first on that database with `connection` and
 * returns the lanes each listing request named.
 */
async function restartAfterCutShortBoot(
  name: string,
  connection: Connection,
  afterHydration: (connect: (next: Connection) => void) => void,
) {
  const { close, execSql } = await createTestExecSql(name);
  const listedLanes: string[][] = [];
  const apiClient = createMockApiClient({
    listContainerDocumentLanes: async ({ lanes }) => {
      listedLanes.push(lanes.map((lane) => lane.containerId).sort());
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
  const fixture = createWorkflowInputFixture({
    apiClient,
    auth: { isAuthenticated: true, organizationId: "org" },
    execSql,
    online: true,
  });
  const withConnection = (next: Connection) => ({
    ...fixture,
    state: {
      ...fixture.state,
      serverEventsConnectionGeneration: next.generation,
      serverEventsPendingConnectAttempt: next.pendingAttempt,
    },
  });
  let input = withConnection(connection);
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
    afterHydration((next) => {
      input = withConnection(next);
      view.updateRuntime(createDeviceFirstWorkflowRuntime(runtime));
    });
    await waitFor(
      async () =>
        (await listOwedDocumentLaneContainerIds(execSql, CONTAINER_IDS))
          .length === 0,
      "The owed lane was never listed and settled after the restart",
    );
    // Let any further listing land before reporting what was listed.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return listedLanes;
  } finally {
    deviceFirst.dispose();
    close();
  }
}

test("a restart with no connect attempt lists only the lanes an earlier boot left owed", async () => {
  const listed = await restartAfterCutShortBoot(
    "device-first-owed-no-attempt",
    { generation: 0 },
    () => {},
  );
  // Settled lanes stay lazy; only the owed one is listed.
  expect(listed).toEqual([["cut-short-folder"]]);
});

test("a restart whose connect attempt never acknowledges still lists the owed lanes", async () => {
  const listed = await restartAfterCutShortBoot(
    "device-first-owed-attempt-ended",
    { generation: 0, pendingAttempt: 1 },
    // The socket opened but never declared its interest.
    (connect) => connect({ generation: 0 }),
  );
  expect(listed).toEqual([["cut-short-folder"]]);
});

test("a restart that connects lists each lane once, in the acknowledgement's catch-up", async () => {
  const listed = await restartAfterCutShortBoot(
    "device-first-owed-acknowledged",
    { generation: 0, pendingAttempt: 1 },
    (connect) => connect({ generation: 1 }),
  );
  expect(listed).toEqual([["cut-short-folder", "listed-folder", "root"]]);
});

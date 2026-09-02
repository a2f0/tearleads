import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ListContainersResponse } from "@tearleads/validators/response";
import { sqlContainerSyncWatermarkPersistence } from "../../../data/persistence/containers/containerSyncWatermarkPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  createContainerParentSyncLane,
  loadContainerSyncLaneCheckRecords,
  loadContainerSyncWatermark,
} from "../containerPersistence";
import { markContainerParentLaneFetched } from "./laneFetchMarkers";
import type { RemoteContainerHydrationState } from "./types";

const finalPage: ListContainersResponse = {
  hasMore: false,
  items: [],
  nextWatermark: null,
  tombstones: [],
};

function expireAfterBegin(execSql: ExecSql): {
  execSql: ExecSql;
  isCurrent: () => boolean;
} {
  let current = true;
  return {
    execSql: (async (...args: Parameters<ExecSql>) => {
      const rows = await execSql(...args);
      if (args[0].trim().toUpperCase().startsWith("BEGIN")) {
        current = false;
      }
      return rows;
    }) as ExecSql,
    isCurrent: () => current,
  };
}

function hydrationState(execSql: ExecSql): RemoteContainerHydrationState {
  return {
    rootLaneHydrated: false,
    runtime: { infra: { execSql } },
  } as unknown as RemoteContainerHydrationState;
}

test("only a fully applied root lane raises the hydration signal", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-root-lane-hydration-signal",
  );
  try {
    const state = hydrationState(execSql);

    await markContainerParentLaneFetched({
      response: finalPage,
      state,
      syncLane: createContainerParentSyncLane("child-container"),
    });
    expect(state.rootLaneHydrated).toBe(false);

    await markContainerParentLaneFetched({
      response: finalPage,
      state,
      syncLane: createContainerParentSyncLane(null),
    });
    expect(state.rootLaneHydrated).toBe(true);
  } finally {
    close();
  }
});

test("an expired lane cannot commit its response watermark", async () => {
  const database = await createTestExecSql(
    "container-lane-watermark-generation",
  );
  try {
    await sqlContainerSyncWatermarkPersistence.ensureSchema(database.execSql);
    const guarded = expireAfterBegin(database.execSql);
    const syncLane = createContainerParentSyncLane(null);

    await expect(
      markContainerParentLaneFetched({
        isCurrent: guarded.isCurrent,
        response: {
          ...finalPage,
          hasMore: true,
          nextWatermark: {
            id: "stale-page",
            updatedAt: "2026-09-01T00:00:00.000Z",
          },
        },
        state: hydrationState(guarded.execSql),
        syncLane,
      }),
    ).resolves.toBe(false);
    await expect(
      loadContainerSyncWatermark(database.execSql, syncLane),
    ).resolves.toBeNull();
  } finally {
    database.close();
  }
});

test("an expired final page cannot commit its lane check marker", async () => {
  const database = await createTestExecSql("container-lane-check-generation");
  try {
    await sqlContainerSyncWatermarkPersistence.ensureSchema(database.execSql);
    const guarded = expireAfterBegin(database.execSql);
    const state = hydrationState(guarded.execSql);
    const syncLane = createContainerParentSyncLane(null);

    await expect(
      markContainerParentLaneFetched({
        isCurrent: guarded.isCurrent,
        response: finalPage,
        state,
        syncLane,
      }),
    ).resolves.toBe(false);
    await expect(
      loadContainerSyncLaneCheckRecords(database.execSql, [syncLane]),
    ).resolves.toEqual([null]);
    expect(state.rootLaneHydrated).toBe(false);
  } finally {
    database.close();
  }
});

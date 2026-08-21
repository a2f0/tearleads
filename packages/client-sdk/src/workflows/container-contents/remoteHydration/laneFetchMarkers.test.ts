import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { ListContainersResponse } from "@symcrypt/validators/response";
import { createContainerParentSyncLane } from "../containerPersistence";
import { markContainerParentLaneFetched } from "./laneFetchMarkers";
import type { RemoteContainerHydrationState } from "./types";

const finalPage: ListContainersResponse = {
  hasMore: false,
  items: [],
  nextWatermark: null,
  tombstones: [],
};

test("only a fully applied root lane raises the hydration signal", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-root-lane-hydration-signal",
  );
  try {
    const state = {
      rootLaneHydrated: false,
      runtime: { infra: { execSql } },
    } as unknown as RemoteContainerHydrationState;

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

import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type {
  ListContainerParentLanesResponse,
  ListContainersResponse,
} from "@symcrypt/validators/response";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { hydrateRemoteContainers } from "./remoteHydration";
import type {
  ContainerState,
  RemoteContainerHydrationState,
} from "./remoteHydration/types";

const emptyLanePage = (): ListContainersResponse => ({
  hasMore: false,
  items: [],
  nextWatermark: null,
  tombstones: [],
});

test("restoration cleanup callback runs only after a complete hydration", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-restoration-completeness",
  );
  try {
    let failNextRequest = true;
    const state = {
      containersById: new Map<string, ContainerState>(),
      persistence: defaultContainerContentsPersistence,
      runtime: {
        apiClient: {
          async listContainerParentLanes(request: {
            lanes: ReadonlyArray<{ laneId: string }>;
          }): Promise<ListContainerParentLanesResponse | null> {
            if (failNextRequest) {
              failNextRequest = false;
              return null;
            }
            return {
              results: request.lanes.map(({ laneId }) => ({
                laneId,
                page: emptyLanePage(),
              })),
            };
          },
        },
        auth: { isAuthenticated: true },
        infra: { dbStatus: "ready", execSql },
        state: { online: true },
        util: { log: () => {} },
      },
    } as unknown as RemoteContainerHydrationState;
    const host = {
      persistContainerState: async () => {
        throw new Error("empty hydration must not persist a container");
      },
      updateSnapshot: () => {},
    };
    let completedHydrations = 0;
    const hydrate = () =>
      hydrateRemoteContainers({
        followDiscoveredParentLanes: true,
        host,
        onFullyHydrated: () => {
          completedHydrations += 1;
        },
        state,
      });

    await hydrate();
    expect(completedHydrations).toBe(0);
    await hydrate();
    expect(completedHydrations).toBe(1);
  } finally {
    await close();
  }
});

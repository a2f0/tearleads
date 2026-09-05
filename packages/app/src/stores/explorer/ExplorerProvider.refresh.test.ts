import { expect, test } from "bun:test";
import {
  createContainerDocumentObjectSyncState,
  createContainerParentSyncLane as createExplorerContainerParentSyncLane,
  createContainerContentsStore as createExplorerStore,
  loadContainerSyncWatermark as loadExplorerContainerSyncWatermark,
} from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";

import {
  createContainerParentLaneBatchMock,
  createMockApiClient,
} from "@tearleads/test-utils";
import {
  listContainersResponse,
  listedContainer,
} from "../../../test/helpers/explorer-provider/explorerProviderFixtures";
import {
  createSqlRuntime,
  runtimeWithPatch,
} from "../../../test/helpers/explorer-provider/explorerProviderHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";

test("explorer store refreshes remote containers on demand after initialization", async () => {
  let runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  let listContainersCalls = 0;
  const listContainersOptions: Array<{ parentId?: string | null }> = [];

  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      listContainerParentLanes: createContainerParentLaneBatchMock(
        async (options) => {
          listContainersCalls += 1;
          listContainersOptions.push(options);

          if (listContainersCalls === 1) {
            return listContainersResponse();
          }

          if (options.parentId === null || options.parentId === undefined) {
            return {
              hasMore: false,
              items: [
                listedContainer({
                  id: "shared-root-container",
                  metadataAccessEpoch: 1,
                  metadataAccessStateHash: "shared-root-access-state-hash-1",
                  metadataDocumentId: "shared-root-metadata-document",
                  organizationId: "org-2",
                  parentId: null,
                }),
              ],
              nextWatermark: {
                id: "shared-root-container",
                updatedAt: "2026-05-05T00:00:00.000Z",
              },
              tombstones: [],
            };
          }

          return listContainersResponse(
            options.parentId === "shared-root-container"
              ? [
                  listedContainer({
                    id: "shared-child-container",
                    metadataAccessEpoch: 1,
                    metadataAccessStateHash: "shared-child-access-state-hash-1",
                    metadataDocumentId: "shared-child-metadata-document",
                    organizationId: "org-2",
                    parentId: "shared-root-container",
                  }),
                ]
              : [],
          );
        },
      ),
    }),
    encapsulationKeyPair: localKeyPair,
    isAuthenticated: true,
    online: true,
  });
  let store: ReturnType<typeof createExplorerStore> | null = null;

  try {
    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

    await waitForCondition(
      () => createdStore.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    expect(createdStore.getSnapshot().nodes).toEqual([]);

    const refreshed = await createdStore.refresh();

    expect(refreshed).toBe(true);

    await waitForCondition(
      () =>
        createdStore
          .getSnapshot()
          .nodes.some((node) => node.id === "shared-root-container"),
      "Explorer refresh did not hydrate shared remote root.",
    );
    await waitForCondition(
      () =>
        createdStore
          .getSnapshot()
          .nodes.some(
            (node) =>
              node.id === "shared-child-container" &&
              node.parentId === "shared-root-container",
          ),
      "Explorer refresh did not hydrate shared remote child container.",
    );
    const refreshedNodes = createdStore.getSnapshot().nodes;
    expect(
      refreshedNodes.find((node) => node.id === "shared-root-container")
        ?.syncState,
    ).toEqual(createContainerDocumentObjectSyncState({}));
    expect(
      refreshedNodes.find((node) => node.id === "shared-child-container")
        ?.syncState,
    ).toEqual(createContainerDocumentObjectSyncState({}));

    expect(listContainersCalls).toBeGreaterThanOrEqual(2);
    expect(
      listContainersOptions.every((options) => !("depth" in options)),
    ).toBe(true);
    expect(
      listContainersOptions.some((options) => options.parentId === null),
    ).toBe(true);
    expect(
      listContainersOptions.some(
        (options) => options.parentId === "shared-root-container",
      ),
    ).toBe(true);
    await expect(
      loadExplorerContainerSyncWatermark(
        runtime.infra.execSql,
        createExplorerContainerParentSyncLane(null),
      ),
    ).resolves.toEqual({
      id: "shared-root-container",
      updatedAt: "2026-05-05T00:00:00.000Z",
    });
  } finally {
    if (store) {
      store.updateRuntime(
        runtimeWithPatch(runtime, { dbStatus: "terminated" }),
      );
    }
    runtime.close();
  }
});

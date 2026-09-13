import { expect, test } from "bun:test";
import { createContainerContentsStore as createExplorerStore } from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerParentLaneBatchMock as batchParentLanes,
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
import { createSignedExplorerRoots } from "../../../test/helpers/explorer-provider/signedExplorerRoots";
import { waitForCondition } from "../../../test/helpers/waitForCondition";

test("explorer sync hydrates container parent lanes concurrently", async () => {
  let runtime = await createSqlRuntime();
  const localKeyPair = generateKemSeedAndKeyPair();
  let activeListContainerCalls = 0;
  let maxActiveListContainerCalls = 0;
  const requestedParentIds: Array<string | null | undefined> = [];

  runtime = runtimeWithPatch(runtime, {
    apiClient: createMockApiClient({
      ...runtime.apiClient,
      ...(await createSignedExplorerRoots([
        {
          id: "parent-a",
          organizationId: "org-1",
          metadataDocumentId: "parent-a-metadata-document",
        },
        {
          id: "parent-b",
          organizationId: "org-1",
          metadataDocumentId: "parent-b-metadata-document",
        },
      ])),
      listContainerParentLanes: batchParentLanes(async (options) => {
        requestedParentIds.push(options.parentId);
        activeListContainerCalls += 1;
        maxActiveListContainerCalls = Math.max(
          maxActiveListContainerCalls,
          activeListContainerCalls,
        );

        try {
          await new Promise((resolve) => {
            setTimeout(
              resolve,
              options.parentId === "parent-a" || options.parentId === "parent-b"
                ? 50
                : 0,
            );
          });

          if (options.parentId === null || options.parentId === undefined) {
            return listContainersResponse([
              listedContainer({
                id: "parent-a",
                metadataAccessEpoch: 1,
                metadataAccessStateHash: "parent-a-access-state-hash-1",
                metadataDocumentId: "parent-a-metadata-document",
                organizationId: "org-1",
                parentId: null,
              }),
              listedContainer({
                id: "parent-b",
                metadataAccessEpoch: 1,
                metadataAccessStateHash: "parent-b-access-state-hash-1",
                metadataDocumentId: "parent-b-metadata-document",
                organizationId: "org-1",
                parentId: null,
              }),
            ]);
          }

          return listContainersResponse();
        } finally {
          activeListContainerCalls -= 1;
        }
      }),
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
    await expect(createdStore.refresh()).resolves.toBe(true);

    await waitForCondition(
      () =>
        maxActiveListContainerCalls > 1 &&
        requestedParentIds.includes("parent-a") &&
        requestedParentIds.includes("parent-b") &&
        createdStore
          .getSnapshot()
          .nodes.some((node) => node.id === "parent-a") &&
        createdStore.getSnapshot().nodes.some((node) => node.id === "parent-b"),
      "Explorer sync did not hydrate sibling parent lanes concurrently.",
    );

    expect(maxActiveListContainerCalls).toBeGreaterThan(1);
  } finally {
    if (store) {
      store.updateRuntime(
        runtimeWithPatch(runtime, { dbStatus: "terminated" }),
      );
    }
    runtime.close();
  }
});

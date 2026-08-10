import { expect, test } from "bun:test";
import {
  discoverContainerDocumentsFromApi,
  refreshAllContainerDocumentsFromApi,
} from "./documentDiscovery";
import { nullContainerDocumentWatermarks } from "./documentDiscovery.testUtils";

test("container document discovery quietly treats missing containers as unavailable lanes", async () => {
  const reported: string[] = [];

  const discovered = await discoverContainerDocumentsFromApi({
    ...nullContainerDocumentWatermarks,
    apiClient: {
      listContainerDocuments: async () => {
        throw new Error("Expected result API to be used.");
      },
      listContainerDocumentsResult: async () => ({
        message: "GET /containers/missing/documents: 404 Not Found",
        ok: false,
        report: () => {
          reported.push("reported");
        },
        status: 404,
      }),
    },
    containerId: "missing",
    replaceDocumentLinksBatch: async () => {},
    upsertDiscoveredDocuments: async () => [],
  });

  expect(discovered).toBeNull();
  expect(reported).toEqual([]);
});

test("manual refresh discovery reports unexpected container document failures", async () => {
  const reported: string[] = [];

  const discovered = await refreshAllContainerDocumentsFromApi({
    ...nullContainerDocumentWatermarks,
    apiClient: {
      listContainerDocuments: async () => {
        throw new Error("Expected result API to be used.");
      },
      listContainerDocumentsResult: async () => ({
        message: "GET /containers/root/documents: 500 Internal Server Error",
        ok: false,
        report: () => {
          reported.push("reported");
        },
        status: 500,
      }),
      listContainerParentLanes: async ({ lanes }) => ({
        results: lanes.map((lane) => ({
          laneId: lane.laneId,
          page: {
            hasMore: false,
            items: lane.parentId === null ? [{ id: "root" }] : [],
            nextWatermark: null,
          },
        })),
      }),
    },
    replaceDocumentLinksBatch: async () => {},
    upsertDiscoveredDocuments: async () => [],
  });

  expect(discovered).toEqual([]);
  expect(reported).toEqual(["reported"]);
});

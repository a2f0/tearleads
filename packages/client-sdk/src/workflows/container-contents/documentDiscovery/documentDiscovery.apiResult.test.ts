import { expect, test } from "bun:test";
import { nullContainerDocumentWatermarks } from "./documentDiscovery.testUtils";
import {
  discoverContainerDocumentsFromApi,
  refreshAllContainerDocumentsFromApi,
} from "./index";

test("container document discovery treats a rejected lane as unlisted", async () => {
  const reportOptions: unknown[] = [];

  const discovered = await discoverContainerDocumentsFromApi({
    ...nullContainerDocumentWatermarks,
    apiClient: {
      listContainerDocumentLanes: async ({ lanes }, options) => {
        reportOptions.push(options);
        return {
          results: lanes.map(({ laneId }) => ({
            failure: { code: "container_not_found" },
            laneId,
          })),
        };
      },
    },
    containerId: "missing",
    replaceDocumentLinksBatch: async () => {},
    upsertDiscoveredDocuments: async () => [],
  });

  expect(discovered).toBeNull();
  // The API client reports every rejection except a positive absence proof.
  expect(reportOptions).toEqual([{ reportErrors: true }]);
});

test("manual refresh discovery survives a failed document-lane request", async () => {
  const discovered = await refreshAllContainerDocumentsFromApi({
    ...nullContainerDocumentWatermarks,
    apiClient: {
      listContainerDocumentLanes: async () => null,
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
});

import { expect, test } from "bun:test";
import type { ListContainerDocumentLanesRequest } from "@tearleads/validators/request";
import type { SyncWatermark } from "@tearleads/validators/response";
import {
  listAllContainerDocumentIdsFromApi,
  listAllContainerDocumentLanes,
  listContainerDocumentLanesFromApi,
} from "./containerDocumentListing";
import { laneApi } from "./documentDiscovery.testUtils";
import type { ListContainerDocumentsResponse } from "./documentDiscoveryTypes";

function page(
  ids: ReadonlyArray<string>,
  next: SyncWatermark | null = null,
): ListContainerDocumentsResponse {
  return {
    hasMore: next !== null,
    items: ids.map((id) => ({
      createdAt: "2026-07-30T12:00:00.000Z",
      currentAccessEpoch: 1,
      currentAccessStateHash: `hash-${id}`,
      id,
      linkedContainerIds: ["container-a"],
      referencedPrincipals: [],
      updatedAt: "2026-07-30T12:00:00.000Z",
    })),
    nextWatermark: next,
    tombstones: [],
  };
}

const watermarkA = { id: "document-a", updatedAt: "2026-07-30T12:00:00.000Z" };

test("authoritative document listing starts without a persisted watermark", async () => {
  const requestedWatermarks: Array<SyncWatermark | null> = [];
  const documentIds = await listAllContainerDocumentIdsFromApi({
    apiClient: laneApi(async (_containerId, options) => {
      requestedWatermarks.push(options.watermark);
      return requestedWatermarks.length === 1
        ? page(["document-a"], watermarkA)
        : page(["document-b"]);
    }),
    containerId: "container-a",
  });

  expect(requestedWatermarks).toEqual([null, watermarkA]);
  expect(documentIds).toEqual(["document-a", "document-b"]);
});

test("authoritative document listing requires every page", async () => {
  const documentIds = await listAllContainerDocumentIdsFromApi({
    apiClient: laneApi(async () => null),
    containerId: "container-a",
  });

  expect(documentIds).toBeNull();
});

test("initial probe listings can suppress failure reports", async () => {
  const reportOptions: unknown[] = [];
  const documentIds = await listAllContainerDocumentIdsFromApi({
    apiClient: {
      listContainerDocumentLanes: async (_input, options) => {
        reportOptions.push(options);
        return null;
      },
    },
    containerId: "container-a",
    reportErrors: false,
  });

  expect(documentIds).toBeNull();
  expect(reportOptions).toEqual([{ reportErrors: false }]);
});

test("batched listing continues only unfinished lanes and isolates failures", async () => {
  const requests: Array<ReadonlyArray<string>> = [];
  const listed = await listAllContainerDocumentLanes({
    lanes: [
      { containerId: "complete", watermark: null },
      { containerId: "paged", watermark: watermarkA },
      { containerId: "rejected", watermark: null },
      { containerId: "complete", watermark: null },
    ],
    listContainerDocumentLanes: async (lanes) => {
      requests.push(
        lanes.map(
          ({ containerId, watermark }) =>
            `${containerId}@${watermark?.id ?? "start"}`,
        ),
      );
      return lanes.map(({ containerId, watermark }) => {
        if (containerId === "rejected") return null;
        if (containerId === "complete") return page(["c"]);
        return watermark?.id === "document-p2"
          ? page(["p2"])
          : page(["p1"], { id: "document-p2", updatedAt: "2026-07-31" });
      });
    },
  });

  // One request covers every first page; only the paged lane continues.
  expect(requests).toEqual([
    ["complete@start", "paged@document-a", "rejected@start"],
    ["paged@document-p2"],
  ]);
  expect(listed.get("complete")).toMatchObject({
    isFullListing: true,
    items: [{ id: "c" }],
  });
  expect(listed.get("paged")).toMatchObject({
    isFullListing: false,
    items: [{ id: "p1" }, { id: "p2" }],
    nextWatermark: null,
  });
  expect(listed.get("rejected")).toBeNull();
});

test("a failed batch request leaves every lane in it unlisted", async () => {
  const listed = await listAllContainerDocumentLanes({
    lanes: [
      { containerId: "a", watermark: null },
      { containerId: "b", watermark: null },
    ],
    listContainerDocumentLanes: async () => null,
  });

  expect([...listed.entries()]).toEqual([
    ["a", null],
    ["b", null],
  ]);
});

test("lanes beyond the request bound split while rows stay within one page", async () => {
  const requests: ListContainerDocumentLanesRequest[] = [];
  const containerIds = Array.from(
    { length: 33 },
    (_, index) => `container-${index}`,
  );
  const listed = await listAllContainerDocumentLanes({
    lanes: containerIds.map((containerId) => ({
      containerId,
      watermark: null,
    })),
    listContainerDocumentLanes: (lanes) =>
      listContainerDocumentLanesFromApi(
        {
          listContainerDocumentLanes: async (input) => {
            requests.push(input);
            return {
              results: input.lanes.map(({ laneId }) => ({
                laneId,
                page: page([]),
              })),
            };
          },
        },
        lanes,
      ),
  });

  expect(requests.map((request) => request.lanes.length)).toEqual([32, 1]);
  expect(requests[0]?.lanes.every((lane) => lane.limit === 15)).toBe(true);
  expect(requests[1]?.lanes[0]?.limit).toBe(100);
  expect(listed.size).toBe(33);
});

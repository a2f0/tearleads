import { expect, test } from "bun:test";
import type { SyncWatermark } from "@tearleads/validators/response";
import { listAllContainerDocumentIdsFromApi } from "./containerDocumentListing";

test("authoritative document listing starts without a persisted watermark", async () => {
  const requestedWatermarks: Array<SyncWatermark | null | undefined> = [];
  const pageTwoWatermark = {
    id: "document-a",
    updatedAt: "2026-07-30T12:00:00.000Z",
  };
  const documentIds = await listAllContainerDocumentIdsFromApi({
    apiClient: {
      listContainerDocuments: async (_containerId, options) => {
        requestedWatermarks.push(options?.watermark);
        if (requestedWatermarks.length === 1) {
          return {
            hasMore: true,
            items: [
              {
                createdAt: "2026-07-30T12:00:00.000Z",
                currentAccessEpoch: 1,
                currentAccessStateHash: "hash-a",
                id: "document-a",
                linkedContainerIds: ["container-a"],
                referencedPrincipals: [],
                updatedAt: "2026-07-30T12:00:00.000Z",
              },
            ],
            nextWatermark: pageTwoWatermark,
            tombstones: [],
          };
        }
        return {
          hasMore: false,
          items: [
            {
              createdAt: "2026-07-30T12:00:00.000Z",
              currentAccessEpoch: 1,
              currentAccessStateHash: "hash-b",
              id: "document-b",
              linkedContainerIds: ["container-a"],
              referencedPrincipals: [],
              updatedAt: "2026-07-30T12:00:00.000Z",
            },
          ],
          nextWatermark: {
            id: "document-b",
            updatedAt: "2026-07-30T12:00:00.000Z",
          },
          tombstones: [],
        };
      },
    },
    containerId: "container-a",
  });

  expect(requestedWatermarks).toEqual([null, pageTwoWatermark]);
  expect(documentIds).toEqual(["document-a", "document-b"]);
});

test("authoritative document listing requires every page", async () => {
  const documentIds = await listAllContainerDocumentIdsFromApi({
    apiClient: {
      listContainerDocuments: async () => null,
    },
    containerId: "container-a",
  });

  expect(documentIds).toBeNull();
});

test("initial probe listings can suppress transient failure reports", async () => {
  const reports: string[] = [];
  const documentIds = await listAllContainerDocumentIdsFromApi({
    apiClient: {
      listContainerDocuments: async () => {
        throw new Error("Expected result API to be used.");
      },
      listContainerDocumentsResult: async () => ({
        message: "GET /containers/container-a/documents: 503 Unavailable",
        ok: false,
        report: () => {
          reports.push("reported");
        },
        status: 503,
      }),
    },
    containerId: "container-a",
    reportErrors: false,
  });

  expect(documentIds).toBeNull();
  expect(reports).toEqual([]);
});

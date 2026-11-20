import { expect, mock, spyOn } from "bun:test";
import { MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES } from "@tearleads/validators/util";
import { createDocumentSyncRequest } from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import { ApiRequestMetrics } from "./apiRequestMetrics";

for (const page of [
  "document sync",
  "folder discovery",
  "document discovery",
] as const)
  testApiClient(
    `verification cancels an oversized ${page} page before decoding`,
    async () => {
      const cancel = mock(() => {});
      const chunk = new Uint8Array(1024 * 1024);
      let supplied = 0;
      const network = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          new ReadableStream(
            {
              pull(controller) {
                supplied += chunk.length;
                if (
                  supplied >
                  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES + chunk.length
                )
                  controller.close();
                else controller.enqueue(chunk);
              },
              cancel,
            },
            { highWaterMark: 0 },
          ),
          { headers: { "Content-Type": "application/json" } },
        ),
      );
      try {
        const client = new ApiClient(apiBaseUrl, {
          metrics: new ApiRequestMetrics(),
          getIdentity: () => null,
          streamingDownloads: true,
          verificationDeadline: new AbortController().signal,
        });
        expect(
          await (page === "document sync"
            ? client.syncDocument("document-1", createDocumentSyncRequest())
            : page === "folder discovery"
              ? client.listContainerParentLanes({
                  lanes: [{ laneId: "root", parentId: null, watermark: null }],
                })
              : client.listContainerDocumentLanes({
                  lanes: [
                    {
                      laneId: "root",
                      containerId: "container-1",
                      watermark: null,
                    },
                  ],
                })),
        ).toBeNull();
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(supplied).toBe(
          MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES + chunk.length,
        );
      } finally {
        network.mockRestore();
      }
    },
  );

testApiClient(
  "stopping seed work allows logout while refusing new document writes",
  async () => {
    const stop = new AbortController();
    const client = new ApiClient(apiBaseUrl, {
      metrics: new ApiRequestMetrics(),
      getIdentity: () => null,
      requestSignal: stop.signal,
    });
    const answer = Promise.withResolvers<Response>();
    const network = spyOn(globalThis, "fetch").mockReturnValue(answer.promise);
    try {
      stop.abort();
      const logout = client.logout();
      expect(
        await client.syncDocument("document-1", createDocumentSyncRequest()),
      ).toBeNull();
      expect(network).toHaveBeenCalledTimes(1);
      answer.resolve(Response.json({ message: "ok" }));
      expect(await logout).toEqual({ message: "ok" });
    } finally {
      answer.resolve(Response.json({ message: "ok" }));
      network.mockRestore();
    }
  },
);

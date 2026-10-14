import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  createDeferred,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const DOCUMENT_LANE_CONTAINER_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const documentLaneRequest = {
  lanes: [
    {
      containerId: DOCUMENT_LANE_CONTAINER_ID,
      laneId: "lane-0",
      watermark: null,
    },
  ],
};

testApiClient(
  "coalesces in-flight container document lanes without caching settled responses",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const firstDocumentsRequestStarted = createDeferred<void>();
    const finishDocumentsRequest = createDeferred<void>();
    const listContainerDocumentLanesResponse = {
      results: [
        {
          laneId: "lane-0",
          page: {
            hasMore: false,
            items: [],
            nextWatermark: null,
            tombstones: [],
          },
        },
      ],
    };

    server.use(
      http.post(
        `${apiBaseUrl}/containers/documents/query`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          if (calls.length === 1) {
            firstDocumentsRequestStarted.resolve();
            await finishDocumentsRequest.promise;
          }
          return HttpResponse.json(listContainerDocumentLanesResponse);
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const firstDocumentsRequest =
      client.listContainerDocumentLanes(documentLaneRequest);
    await firstDocumentsRequestStarted.promise;
    const secondDocumentsRequest =
      client.listContainerDocumentLanes(documentLaneRequest);
    finishDocumentsRequest.resolve();
    await expect(
      Promise.all([firstDocumentsRequest, secondDocumentsRequest]),
    ).resolves.toEqual([
      listContainerDocumentLanesResponse,
      listContainerDocumentLanesResponse,
    ]);

    await expect(
      client.listContainerDocumentLanes(documentLaneRequest),
    ).resolves.toEqual(listContainerDocumentLanesResponse);

    expect(calls.map((call) => call.method)).toEqual(["POST", "POST"]);
  },
);

testApiClient(
  "reports rejected document lanes except positive absence proofs",
  async () => {
    const errors: string[] = [];
    server.use(
      http.post(`${apiBaseUrl}/containers/documents/query`, () =>
        HttpResponse.json({
          results: [
            {
              failure: { error: "Forbidden", status: 403 },
              laneId: "foreign",
            },
            {
              failure: {
                code: "container_not_found",
                error: "Container not found",
                status: 404,
              },
              laneId: "missing",
            },
          ],
        }),
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    client.setOnError((message) => errors.push(message));
    const request = {
      lanes: ["foreign", "missing"].map((laneId) => ({
        containerId: DOCUMENT_LANE_CONTAINER_ID,
        laneId,
        watermark: null,
      })),
    };

    await expect(
      client.listContainerDocumentLanes(request, { reportErrors: false }),
    ).resolves.not.toBeNull();
    expect(errors).toEqual([]);
    await expect(
      client.listContainerDocumentLanes(request),
    ).resolves.not.toBeNull();
    expect(errors).toEqual(["POST /containers/documents/query: 403 Forbidden"]);
  },
);

testApiClient(
  "rejects document-lane responses that do not answer the requested lanes",
  async () => {
    server.use(
      http.post(`${apiBaseUrl}/containers/documents/query`, () =>
        HttpResponse.json({
          results: [
            {
              laneId: "unexpected",
              page: {
                hasMore: false,
                items: [],
                nextWatermark: null,
                tombstones: [],
              },
            },
          ],
        }),
      ),
    );
    const client = new ApiClient(apiBaseUrl);

    await expect(
      client.listContainerDocumentLanes(documentLaneRequest, {
        reportErrors: false,
      }),
    ).resolves.toBeNull();
  },
);

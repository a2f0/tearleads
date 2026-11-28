import { expect } from "bun:test";
import type { ListContainerParentLanesResponse } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

function emptyContainerPage(): Extract<
  ListContainerParentLanesResponse["results"][number],
  { page: unknown }
>["page"] {
  return {
    hasMore: false,
    items: [],
    nextWatermark: null,
    tombstones: [],
  };
}

testApiClient(
  "distinguishes idsOnly parent-lane requests and rejects mismatched result shapes",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.post(
        `${apiBaseUrl}/containers/parent-lanes/query`,
        async ({ request: httpRequest }) => {
          calls.push(await captureHttpCall(httpRequest));
          return HttpResponse.json({
            results: [
              {
                idsPage: {
                  hasMore: false,
                  items: [
                    {
                      directAccessLevel: "admin",
                      id: "container-1",
                      organizationId: "org-1",
                      parentId: null,
                    },
                  ],
                  nextWatermark: null,
                },
                laneId: "root",
              },
            ],
          });
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const errors: string[] = [];
    client.setOnError((message) => {
      errors.push(message);
    });

    const idsResult = await client.listContainerParentLanes({
      lanes: [
        { idsOnly: true, laneId: "root", parentId: null, watermark: null },
      ],
    });
    expect(idsResult).toEqual({
      results: [
        {
          idsPage: {
            hasMore: false,
            items: [
              {
                directAccessLevel: "admin",
                id: "container-1",
                organizationId: "org-1",
                parentId: null,
              },
            ],
            nextWatermark: null,
          },
          laneId: "root",
        },
      ],
    });
    // Returning an idsPage for a non-idsOnly request is rejected as malformed.
    await expect(
      client.listContainerParentLanes({
        lanes: [{ laneId: "root", parentId: null, watermark: null }],
      }),
    ).resolves.toBeNull();
    expect(errors).toEqual([
      "Invalid response shape for /containers/parent-lanes/query",
    ]);
    expect(calls).toHaveLength(2);
  },
);

testApiClient(
  "reports per-lane non-absence parent-lane failures while returning the batch",
  async () => {
    server.use(
      http.post(`${apiBaseUrl}/containers/parent-lanes/query`, () =>
        HttpResponse.json({
          results: [
            { laneId: "healthy", page: emptyContainerPage() },
            {
              failure: {
                error: "Container manifest bundle missing",
                status: 409,
              },
              laneId: "broken",
            },
          ],
        }),
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    const errors: string[] = [];
    client.setOnError((message) => {
      errors.push(message);
    });

    const result = await client.listContainerParentLanes({
      lanes: [
        { laneId: "healthy", parentId: null, watermark: null },
        {
          laneId: "broken",
          parentId: "11111111-1111-4111-8111-111111111111",
          watermark: null,
        },
      ],
    });
    expect(result?.results).toHaveLength(2);
    expect(errors).toEqual([
      "POST /containers/parent-lanes/query: 409 Container manifest bundle missing",
    ]);
  },
);

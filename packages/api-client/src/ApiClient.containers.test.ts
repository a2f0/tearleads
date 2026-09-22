import { expect } from "bun:test";
import type { ListContainerParentLanesRequest } from "@tearleads/validators/request";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  type ListContainerParentLanesResponse,
} from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  createContainerCreateWithMetadataDocumentRequest,
  createContainerCreateWithMetadataDocumentResponse,
  createContainerDeleteResponse,
  createContainerMutationRequest,
  createContainerMutationResponse,
  createPrincipalPolicyBundleResponse,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  createDeferred,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

testApiClient(
  "posts signed container mutations to the route namespace",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.all(`${apiBaseUrl}/*`, async ({ request }) => {
        calls.push(await captureHttpCall(request));
        return HttpResponse.json(createContainerMutationResponse());
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const mutation = createContainerMutationRequest();

    expect(await client.createContainer(mutation)).not.toBeNull();
    expect(await client.shareContainer("container-1", mutation)).not.toBeNull();
    expect(
      await client.revokeContainer("container-1", mutation),
    ).not.toBeNull();
    expect(await client.rekeyContainer("container-1", mutation)).not.toBeNull();
    expect(await client.moveContainer("container-1", mutation)).not.toBeNull();

    expect(
      calls.map((call) => ({
        body: call.body,
        contentType: call.contentType,
        input: call.url,
        method: call.method,
      })),
    ).toEqual([
      {
        body: JSON.stringify(mutation),
        contentType: "application/json",
        input: `${apiBaseUrl}/containers`,
        method: "POST",
      },
      {
        body: JSON.stringify(mutation),
        contentType: "application/json",
        input: `${apiBaseUrl}/containers/container-1/share`,
        method: "POST",
      },
      {
        body: JSON.stringify(mutation),
        contentType: "application/json",
        input: `${apiBaseUrl}/containers/container-1/revoke`,
        method: "POST",
      },
      {
        body: JSON.stringify(mutation),
        contentType: "application/json",
        input: `${apiBaseUrl}/containers/container-1/rekey`,
        method: "POST",
      },
      {
        body: JSON.stringify(mutation),
        contentType: "application/json",
        input: `${apiBaseUrl}/containers/container-1/move`,
        method: "POST",
      },
    ]);
  },
);

testApiClient(
  "posts composite container metadata creates to the route namespace",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.all(`${apiBaseUrl}/*`, async ({ request }) => {
        calls.push(await captureHttpCall(request));
        return HttpResponse.json(
          createContainerCreateWithMetadataDocumentResponse(),
        );
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const request = createContainerCreateWithMetadataDocumentRequest();

    expect(
      await client.createContainerWithMetadataDocument(request),
    ).not.toBeNull();

    expect(
      calls.map((call) => ({
        body: call.body,
        input: call.url,
        method: call.method,
      })),
    ).toEqual([
      {
        body: JSON.stringify(request),
        input: `${apiBaseUrl}/containers/with-metadata-document`,
        method: "POST",
      },
    ]);
  },
);

testApiClient(
  "returns stale principal policy bundles from container create failures",
  async () => {
    const principalPolicy = createPrincipalPolicyBundleResponse();
    server.use(
      http.post(`${apiBaseUrl}/containers/with-metadata-document`, () => {
        return HttpResponse.json(
          {
            error: "Principal policy is stale",
            code: "principal_policy_stale",
            principalPolicies: [principalPolicy],
          },
          { status: 409, statusText: "Conflict" },
        );
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const result = await client.createContainerWithMetadataDocumentResult(
      createContainerCreateWithMetadataDocumentRequest(),
      { reportErrors: false },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected create failure");
    }
    expect(result.status).toBe(409);
    expect(result.stalePrincipalPolicies).toEqual([principalPolicy]);
  },
);

testApiClient("deletes containers through the route namespace", async () => {
  const calls: CapturedHttpCall[] = [];
  server.use(
    http.all(`${apiBaseUrl}/*`, async ({ request }) => {
      calls.push(await captureHttpCall(request));
      return HttpResponse.json(createContainerDeleteResponse());
    }),
  );

  const client = new ApiClient(apiBaseUrl);

  expect(await client.deleteContainer("container-1")).toEqual(
    createContainerDeleteResponse(),
  );
  expect(
    calls.map((call) => ({
      body: call.body,
      input: call.url,
      method: call.method,
    })),
  ).toEqual([
    {
      body: "",
      input: `${apiBaseUrl}/containers/container-1`,
      method: "DELETE",
    },
  ]);
});

testApiClient(
  "returns container delete failures without reporting when requested",
  async () => {
    server.use(
      http.delete(`${apiBaseUrl}/containers/:containerId`, () => {
        return HttpResponse.json(
          {
            code: CONTAINER_NOT_FOUND_ERROR_CODE,
            error: "Container not found",
          },
          {
            status: 404,
            statusText: "Not Found",
          },
        );
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const errors: string[] = [];
    client.setOnError((message) => {
      errors.push(message);
    });

    const result = await client.deleteContainerResult("container-1", {
      reportErrors: false,
    });

    expect(result.ok).toBe(false);
    expect(errors).toEqual([]);
    if (result.ok) {
      throw new Error("Expected container delete result failure");
    }
    expect(result.status).toBe(404);
    expect(result.message).toBe(
      "DELETE /containers/container-1: 404 Not Found: Container not found",
    );
  },
);

function emptyContainerPage(): ListContainerParentLanesResponse["results"][number]["page"] {
  return {
    hasMore: false,
    items: [],
    nextWatermark: null,
    tombstones: [],
  };
}

testApiClient("posts an exact parent-lane batch request", async () => {
  const calls: CapturedHttpCall[] = [];
  const request = {
    lanes: [
      {
        laneId: "root",
        parentId: null,
        watermark: null,
        limit: 50,
      },
      {
        laneId: "child",
        parentId: "11111111-1111-4111-8111-111111111111",
        watermark: {
          id: "container-watermark",
          updatedAt: "2026-07-18T12:00:00.000Z",
        },
      },
    ],
  } satisfies ListContainerParentLanesRequest;
  const response = {
    results: request.lanes.toReversed().map((lane) => ({
      laneId: lane.laneId,
      page: emptyContainerPage(),
    })),
  } satisfies ListContainerParentLanesResponse;
  server.use(
    http.post(
      `${apiBaseUrl}/containers/parent-lanes/query`,
      async ({ request: httpRequest }) => {
        calls.push(await captureHttpCall(httpRequest));
        return HttpResponse.json(response);
      },
    ),
  );

  const client = new ApiClient(apiBaseUrl);

  await expect(client.listContainerParentLanes(request)).resolves.toEqual(
    response,
  );
  expect(calls).toEqual([
    {
      authorization: null,
      body: JSON.stringify(request),
      contentType: "application/json",
      method: "POST",
      url: `${apiBaseUrl}/containers/parent-lanes/query`,
    },
  ]);
});

testApiClient(
  "coalesces identical in-flight parent-lane batches without caching settled responses",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const firstRequestStarted = createDeferred<void>();
    const finishFirstRequest = createDeferred<void>();
    const request = {
      lanes: [
        {
          laneId: "root",
          limit: 50,
          parentId: null,
          watermark: null,
        },
        {
          laneId: "child",
          parentId: "11111111-1111-4111-8111-111111111111",
          watermark: {
            id: "container-watermark",
            updatedAt: "2026-07-18T12:00:00.000Z",
          },
        },
      ],
    } satisfies ListContainerParentLanesRequest;
    const response = {
      results: request.lanes.map((lane) => ({
        laneId: lane.laneId,
        page: emptyContainerPage(),
      })),
    };

    server.use(
      http.post(
        `${apiBaseUrl}/containers/parent-lanes/query`,
        async ({ request: httpRequest }) => {
          calls.push(await captureHttpCall(httpRequest));
          if (calls.length === 1) {
            firstRequestStarted.resolve();
            await finishFirstRequest.promise;
          }
          return HttpResponse.json(response);
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const firstRequest = client.listContainerParentLanes(request);
    await firstRequestStarted.promise;
    const secondRequest = client.listContainerParentLanes(request);
    finishFirstRequest.resolve();

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      response,
      response,
    ]);
    await expect(client.listContainerParentLanes(request)).resolves.toEqual(
      response,
    );
    expect(calls.map((call) => call.body)).toEqual([
      JSON.stringify(request),
      JSON.stringify(request),
    ]);
  },
);

testApiClient("rejects a malformed parent-lane batch response", async () => {
  server.use(
    http.post(`${apiBaseUrl}/containers/parent-lanes/query`, () =>
      HttpResponse.json({
        results: [{ laneId: "root", page: null }],
      }),
    ),
  );

  const client = new ApiClient(apiBaseUrl);
  const errors: string[] = [];
  client.setOnError((message) => {
    errors.push(message);
  });

  await expect(
    client.listContainerParentLanes({
      lanes: [{ laneId: "root", parentId: null, watermark: null }],
    }),
  ).resolves.toBeNull();
  expect(errors).toEqual([
    "Invalid response shape for /containers/parent-lanes/query",
  ]);
});

testApiClient("rejects missing or unexpected parent-lane results", async () => {
  server.use(
    http.post(`${apiBaseUrl}/containers/parent-lanes/query`, () =>
      HttpResponse.json({
        results: [
          { laneId: "root", page: emptyContainerPage() },
          { laneId: "unexpected", page: emptyContainerPage() },
        ],
      }),
    ),
  );

  const client = new ApiClient(apiBaseUrl);
  const errors: string[] = [];
  client.setOnError((message) => {
    errors.push(message);
  });

  await expect(
    client.listContainerParentLanes({
      lanes: [
        { laneId: "root", parentId: null, watermark: null },
        {
          laneId: "child",
          parentId: "11111111-1111-4111-8111-111111111111",
          watermark: null,
        },
      ],
    }),
  ).resolves.toBeNull();
  expect(errors).toEqual([
    "Invalid response shape for /containers/parent-lanes/query",
  ]);
});

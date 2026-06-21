import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import { ApiClient } from "./ApiClient";
import {
  createContainerCreateWithMetadataDocumentRequest,
  createContainerCreateWithMetadataDocumentResponse,
  createContainerDeleteResponse,
  createContainerMutationRequest,
  createContainerMutationResponse,
  createPrincipalPolicyBundleResponse,
} from "./ApiClient.testFactories";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  server,
  testApiClient,
} from "./ApiClient.testHarness";

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

import { expect, test } from "bun:test";
import type { ContainerV2MutationRequest } from "@tearleads/validators/request";
import { ApiClient } from "./ApiClient";

function createContainerV2MutationRequest(): ContainerV2MutationRequest {
  return {
    event: { eventType: "container.create" },
    body: { eventType: "container.create" },
    expectedManifestHash: "manifest-hash",
    manifest: { objectKind: "container" },
    keyEpoch: { containerKeyEpochId: "container-key-epoch-id" },
    wraps: [],
  };
}

function createContainerV2MutationResponse() {
  return {
    containerId: "container-1",
    organizationId: "organization-1",
    parentId: "parent-1",
    manifestHead: {
      epoch: 1,
      manifestHash: "container-manifest-hash",
    },
    accessManifest: {
      event: {
        event: { eventType: "container.create" },
        body: { eventType: "container.create" },
        eventHash: "container-event-hash",
      },
      manifest: { objectKind: "container" },
      manifestHash: "container-manifest-hash",
      state: { containerId: "container-1" },
    },
    containerKek: {
      containerId: "container-1",
      accessManifestHash: "container-manifest-hash",
      containerKeyEpochId: "container-key-epoch-id",
      containerKeyEpoch: 1,
      keyEpoch: { containerKeyEpochId: "container-key-epoch-id" },
      keyEpochHash: "key-epoch-hash",
      keyTargetHash: "key-target-hash",
      parentContainerKeyEpochId: null,
      recipientTargets: [{ recipientKind: "user" }],
      wraps: [{ containerKeyEpochId: "container-key-epoch-id" }],
    },
    referencedPrincipalHeads: [],
  };
}

test("includes authorization header after authentication", async () => {
  const originalFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  const fetchMock = Object.assign(
    async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ message: "ok" }));
    },
    { preconnect: originalFetch.preconnect },
  );
  globalThis.fetch = fetchMock;

  const client = new ApiClient("http://api.test");
  client.setAuthToken("abc");

  await client.getHealth();

  expect(calls[0]?.headers).toEqual({
    "Content-Type": "application/json",
    Authorization: "Bearer abc",
  });

  globalThis.fetch = originalFetch;
});

test("returns null on network error", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = Object.assign(
    async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> => {
      throw new Error("offline");
    },
    { preconnect: originalFetch.preconnect },
  );
  globalThis.fetch = fetchMock;

  const client = new ApiClient("http://api.test");
  expect(await client.getHealth()).toBeNull();
  globalThis.fetch = originalFetch;
});

test("includes backend error details in onError output for non-2xx responses", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = Object.assign(
    async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
      new Response(
        JSON.stringify({
          error: "Container metadata access state is unavailable",
        }),
        {
          status: 409,
          statusText: "Conflict",
          headers: { "Content-Type": "application/json" },
        },
      ),
    { preconnect: originalFetch.preconnect },
  );
  globalThis.fetch = fetchMock;

  const client = new ApiClient("http://api.test");
  const errors: string[] = [];
  client.setOnError((message) => {
    errors.push(message);
  });

  expect(
    await client.shareContainer(
      "container-1",
      "user",
      "user-2",
      "write",
      "access-state-1",
    ),
  ).toBeNull();
  expect(errors).toEqual([
    "POST /containers/container-1/share: 409 Conflict: Container metadata access state is unavailable",
  ]);

  globalThis.fetch = originalFetch;
});

test("posts signed V2 container mutations to the V2 route namespace", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{
    input: RequestInfo | URL;
    init: RequestInit | undefined;
  }> = [];
  const fetchMock = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ input, init });
      return new Response(JSON.stringify(createContainerV2MutationResponse()), {
        headers: { "Content-Type": "application/json" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  globalThis.fetch = fetchMock;

  try {
    const client = new ApiClient("http://api.test");
    const mutation = createContainerV2MutationRequest();

    expect(await client.createContainerV2(mutation)).not.toBeNull();
    expect(
      await client.shareContainerV2("container-1", mutation),
    ).not.toBeNull();
    expect(
      await client.revokeContainerV2("container-1", mutation),
    ).not.toBeNull();
    expect(
      await client.moveContainerV2("container-1", mutation),
    ).not.toBeNull();

    expect(
      calls.map((call) => ({
        body: call.init?.body,
        input: String(call.input),
        method: call.init?.method,
      })),
    ).toEqual([
      {
        body: JSON.stringify(mutation),
        input: "http://api.test/v2/containers",
        method: "POST",
      },
      {
        body: JSON.stringify(mutation),
        input: "http://api.test/v2/containers/container-1/share",
        method: "POST",
      },
      {
        body: JSON.stringify(mutation),
        input: "http://api.test/v2/containers/container-1/revoke",
        method: "POST",
      },
      {
        body: JSON.stringify(mutation),
        input: "http://api.test/v2/containers/container-1/move",
        method: "POST",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import type {
  ContainerV2MutationRequest,
  DocumentV2CreateRequest,
  DocumentV2LinkSetMutationRequest,
  DocumentV2SyncRequest,
} from "@tearleads/validators/request";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { ApiClient } from "./ApiClient";

const apiBaseUrl = "http://api.test";
const server = setupServer();

interface CapturedHttpCall {
  readonly authorization: string | null;
  readonly body: string | null;
  readonly contentType: string | null;
  readonly method: string;
  readonly url: string;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

async function captureHttpCall(request: Request): Promise<CapturedHttpCall> {
  return {
    authorization: request.headers.get("authorization"),
    body:
      request.method === "GET" || request.method === "HEAD"
        ? null
        : await request.clone().text(),
    contentType: request.headers.get("content-type"),
    method: request.method,
    url: request.url,
  };
}

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

function createDocumentV2LinkSetMutationRequest(): DocumentV2LinkSetMutationRequest {
  return {
    event: { eventType: "document.link" },
    body: { eventType: "document.link" },
    expectedManifestHash: "document-manifest-hash",
    manifest: { objectKind: "document" },
    previousManifest: {
      event: { eventType: "document.link" },
      manifest: { objectKind: "document" },
      manifestHash: "previous-document-manifest-hash",
      state: { documentId: "document-1" },
    },
    targetContainerPath: [{ manifestHash: "container-manifest-hash" }],
    authorizingContainerPaths: [[{ manifestHash: "container-manifest-hash" }]],
    contentKeyBundle: {
      contentKeyEpoch: 1,
      linkSetManifestHash: "document-manifest-hash",
      targetHash: "target-hash",
      targets: [
        {
          containerId: "container-1",
          containerManifestHash: "container-manifest-hash",
          containerKeyEpochId: "container-key-epoch-id",
          containerKeyEpoch: 1,
          wrappedKey: "wrapped-key",
          wrappingMetadata: { alg: "test" },
        },
      ],
    },
  };
}

function createDocumentV2LinkSetMutationResponse() {
  return {
    id: "document-1",
    accessManifest: {
      event: {
        event: { eventType: "document.link" },
        body: { eventType: "document.link" },
        eventHash: "document-event-hash",
      },
      manifest: { objectKind: "document" },
      manifestHash: "document-manifest-hash",
      state: { documentId: "document-1" },
    },
    contentKeyBundle: {
      documentId: "document-1",
      contentKeyEpoch: 1,
      linkSetManifestHash: "document-manifest-hash",
      targetHash: "target-hash",
      targets: [
        {
          containerId: "container-1",
          containerManifestHash: "container-manifest-hash",
          containerKeyEpochId: "container-key-epoch-id",
          containerKeyEpoch: 1,
          wrappedKey: "wrapped-key",
          wrappingMetadata: { alg: "test" },
        },
      ],
    },
    documentKekTargets: {
      documentId: "document-1",
      linkSetManifestHash: "document-manifest-hash",
      linkedContainerManifestHashes: ["container-manifest-hash"],
      linkedContainerKeyEpochIds: ["container-key-epoch-id"],
      targets: [
        {
          containerId: "container-1",
          containerManifestHash: "container-manifest-hash",
          containerKeyEpochId: "container-key-epoch-id",
          containerKeyEpoch: 1,
        },
      ],
      documentKeyTargetHash: "target-hash",
    },
  };
}

function createDocumentV2CreateRequest(): DocumentV2CreateRequest {
  return {
    event: { eventType: "document.link" },
    body: { eventType: "document.link" },
    expectedManifestHash: "document-manifest-hash",
    manifest: { objectKind: "document" },
    previousManifest: null,
    targetContainerPath: [{ manifestHash: "container-manifest-hash" }],
    contentKeyBundle: {
      contentKeyEpoch: 1,
      linkSetManifestHash: "document-manifest-hash",
      targetHash: "target-hash",
      targets: [
        {
          containerId: "container-1",
          containerManifestHash: "container-manifest-hash",
          containerKeyEpochId: "container-key-epoch-id",
          containerKeyEpoch: 1,
          wrappedKey: "wrapped-key",
          wrappingMetadata: { alg: "test" },
        },
      ],
    },
  };
}

function createDocumentV2CreateResponse() {
  return {
    ...createDocumentV2LinkSetMutationResponse(),
    createdAt: "2026-04-28T00:00:00.000Z",
  };
}

function createDocumentV2SyncRequest(): DocumentV2SyncRequest {
  return {
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "document-manifest-hash",
    expectedTargetHash: "target-hash",
    localVersionVector: null,
    outgoingUpdates: [],
  };
}

function createDocumentV2SyncResponse() {
  const mutationResponse = createDocumentV2LinkSetMutationResponse();

  return {
    acceptedOutgoingUpdateIds: [],
    commitLsn: "0/16B6C50",
    contentKeyBundle: mutationResponse.contentKeyBundle,
    documentId: mutationResponse.id,
    documentKekTargets: mutationResponse.documentKekTargets,
    missingUpdateEpochs: [],
    updates: [],
  };
}

test("includes authorization header after authentication", async () => {
  const calls: CapturedHttpCall[] = [];
  server.use(
    http.get(`${apiBaseUrl}/`, async ({ request }) => {
      calls.push(await captureHttpCall(request));
      return HttpResponse.json({ message: "ok" });
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  client.setAuthToken("abc");

  await client.getHealth();

  const call = calls[0];
  expect(call).toBeDefined();
  if (!call) {
    throw new Error("expected getHealth HTTP call");
  }
  expect(call.authorization).toBe("Bearer abc");
  expect(call.contentType).toBe("application/json");
});

test("returns null on network error", async () => {
  server.use(
    http.get(`${apiBaseUrl}/`, () => {
      return HttpResponse.error();
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  expect(await client.getHealth()).toBeNull();
});

test("includes backend error details in onError output for non-2xx responses", async () => {
  server.use(
    http.post(`${apiBaseUrl}/v2/containers/:containerId/share`, () => {
      return HttpResponse.json(
        {
          error: "Stale container manifest",
        },
        {
          status: 409,
          statusText: "Conflict",
        },
      );
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const errors: string[] = [];
  client.setOnError((message) => {
    errors.push(message);
  });

  expect(
    await client.shareContainerV2(
      "container-1",
      createContainerV2MutationRequest(),
    ),
  ).toBeNull();
  expect(errors).toEqual([
    "POST /v2/containers/container-1/share: 409 Conflict: Stale container manifest",
  ]);
});

test("posts signed V2 container mutations to the V2 route namespace", async () => {
  const calls: CapturedHttpCall[] = [];
  server.use(
    http.all(`${apiBaseUrl}/*`, async ({ request }) => {
      calls.push(await captureHttpCall(request));
      return HttpResponse.json(createContainerV2MutationResponse());
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const mutation = createContainerV2MutationRequest();

  expect(await client.createContainerV2(mutation)).not.toBeNull();
  expect(await client.shareContainerV2("container-1", mutation)).not.toBeNull();
  expect(
    await client.revokeContainerV2("container-1", mutation),
  ).not.toBeNull();
  expect(await client.rekeyContainerV2("container-1", mutation)).not.toBeNull();
  expect(await client.moveContainerV2("container-1", mutation)).not.toBeNull();

  expect(
    calls.map((call) => ({
      body: call.body,
      input: call.url,
      method: call.method,
    })),
  ).toEqual([
    {
      body: JSON.stringify(mutation),
      input: `${apiBaseUrl}/v2/containers`,
      method: "POST",
    },
    {
      body: JSON.stringify(mutation),
      input: `${apiBaseUrl}/v2/containers/container-1/share`,
      method: "POST",
    },
    {
      body: JSON.stringify(mutation),
      input: `${apiBaseUrl}/v2/containers/container-1/revoke`,
      method: "POST",
    },
    {
      body: JSON.stringify(mutation),
      input: `${apiBaseUrl}/v2/containers/container-1/rekey`,
      method: "POST",
    },
    {
      body: JSON.stringify(mutation),
      input: `${apiBaseUrl}/v2/containers/container-1/move`,
      method: "POST",
    },
  ]);
});

test("posts signed V2 document link-set mutations to the V2 route namespace", async () => {
  const calls: CapturedHttpCall[] = [];
  server.use(
    http.all(`${apiBaseUrl}/*`, async ({ request }) => {
      calls.push(await captureHttpCall(request));
      return HttpResponse.json(createDocumentV2LinkSetMutationResponse());
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const mutation = createDocumentV2LinkSetMutationRequest();

  expect(await client.linkDocumentV2("document-1", mutation)).not.toBeNull();
  expect(await client.unlinkDocumentV2("document-1", mutation)).not.toBeNull();

  expect(
    calls.map((call) => ({
      body: call.body,
      input: call.url,
      method: call.method,
    })),
  ).toEqual([
    {
      body: JSON.stringify(mutation),
      input: `${apiBaseUrl}/v2/documents/document-1/link`,
      method: "POST",
    },
    {
      body: JSON.stringify(mutation),
      input: `${apiBaseUrl}/v2/documents/document-1/unlink`,
      method: "POST",
    },
  ]);
});

test("posts signed V2 document create and sync mutations to the V2 route namespace", async () => {
  const calls: CapturedHttpCall[] = [];
  server.use(
    http.all(`${apiBaseUrl}/*`, async ({ request }) => {
      calls.push(await captureHttpCall(request));
      const body = request.url.endsWith("/sync")
        ? createDocumentV2SyncResponse()
        : createDocumentV2CreateResponse();
      return HttpResponse.json(body);
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const createRequest = createDocumentV2CreateRequest();
  const syncRequest = createDocumentV2SyncRequest();

  expect(await client.createDocumentV2(createRequest)).not.toBeNull();
  expect(await client.syncDocumentV2("document-1", syncRequest)).not.toBeNull();

  expect(
    calls.map((call) => ({
      body: call.body,
      input: call.url,
      method: call.method,
    })),
  ).toEqual([
    {
      body: JSON.stringify(createRequest),
      input: `${apiBaseUrl}/v2/documents`,
      method: "POST",
    },
    {
      body: JSON.stringify(syncRequest),
      input: `${apiBaseUrl}/v2/documents/document-1/sync`,
      method: "POST",
    },
  ]);
});

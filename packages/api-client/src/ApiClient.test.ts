import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import type {
  ContainerMutationRequest,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentSyncRequest,
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

function createContainerMutationRequest(): ContainerMutationRequest {
  return {
    event: { eventType: "container.create" },
    body: { eventType: "container.create" },
    expectedManifestHash: "manifest-hash",
    manifest: { objectKind: "container" },
    keyEpoch: { containerKeyEpochId: "container-key-epoch-id" },
    wraps: [],
  };
}

function createContainerMutationResponse() {
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

function createDocumentLinkSetMutationRequest(): DocumentLinkSetMutationRequest {
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

function createDocumentLinkSetMutationResponse() {
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

function createDocumentCreateRequest(): DocumentCreateRequest {
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

function createDocumentCreateResponse() {
  return {
    ...createDocumentLinkSetMutationResponse(),
    createdAt: "2026-04-28T00:00:00.000Z",
  };
}

function createDocumentSyncRequest(): DocumentSyncRequest {
  return {
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "document-manifest-hash",
    expectedTargetHash: "target-hash",
    localVersionVector: null,
    outgoingUpdates: [],
  };
}

function createDocumentSyncResponse() {
  const mutationResponse = createDocumentLinkSetMutationResponse();

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

test("allows public methods to be called after destructuring", async () => {
  const calls: CapturedHttpCall[] = [];
  server.use(
    http.get(`${apiBaseUrl}/`, async ({ request }) => {
      calls.push(await captureHttpCall(request));
      return HttpResponse.json({ message: "ok" });
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const { getHealth, setAuthToken } = client;

  setAuthToken("abc");
  await getHealth();

  const call = calls[0];
  expect(call).toBeDefined();
  if (!call) {
    throw new Error("expected destructured getHealth HTTP call");
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
    http.post(`${apiBaseUrl}/containers/:containerId/share`, () => {
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
    await client.shareContainer(
      "container-1",
      createContainerMutationRequest(),
    ),
  ).toBeNull();
  expect(errors).toEqual([
    "POST /containers/container-1/share: 409 Conflict: Stale container manifest",
  ]);
});

test("posts signed container mutations to the route namespace", async () => {
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
  expect(await client.revokeContainer("container-1", mutation)).not.toBeNull();
  expect(await client.rekeyContainer("container-1", mutation)).not.toBeNull();
  expect(await client.moveContainer("container-1", mutation)).not.toBeNull();

  expect(
    calls.map((call) => ({
      body: call.body,
      input: call.url,
      method: call.method,
    })),
  ).toEqual([
    {
      body: JSON.stringify(mutation),
      input: `${apiBaseUrl}/containers`,
      method: "POST",
    },
    {
      body: JSON.stringify(mutation),
      input: `${apiBaseUrl}/containers/container-1/share`,
      method: "POST",
    },
    {
      body: JSON.stringify(mutation),
      input: `${apiBaseUrl}/containers/container-1/revoke`,
      method: "POST",
    },
    {
      body: JSON.stringify(mutation),
      input: `${apiBaseUrl}/containers/container-1/rekey`,
      method: "POST",
    },
    {
      body: JSON.stringify(mutation),
      input: `${apiBaseUrl}/containers/container-1/move`,
      method: "POST",
    },
  ]);
});

test("posts signed document link-set mutations to the route namespace", async () => {
  const calls: CapturedHttpCall[] = [];
  server.use(
    http.all(`${apiBaseUrl}/*`, async ({ request }) => {
      calls.push(await captureHttpCall(request));
      return HttpResponse.json(createDocumentLinkSetMutationResponse());
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const mutation = createDocumentLinkSetMutationRequest();

  expect(await client.linkDocument("document-1", mutation)).not.toBeNull();
  expect(await client.unlinkDocument("document-1", mutation)).not.toBeNull();

  expect(
    calls.map((call) => ({
      body: call.body,
      input: call.url,
      method: call.method,
    })),
  ).toEqual([
    {
      body: JSON.stringify(mutation),
      input: `${apiBaseUrl}/documents/document-1/link`,
      method: "POST",
    },
    {
      body: JSON.stringify(mutation),
      input: `${apiBaseUrl}/documents/document-1/unlink`,
      method: "POST",
    },
  ]);
});

test("posts signed document create and sync mutations to the route namespace", async () => {
  const calls: CapturedHttpCall[] = [];
  server.use(
    http.all(`${apiBaseUrl}/*`, async ({ request }) => {
      calls.push(await captureHttpCall(request));
      const body = request.url.endsWith("/sync")
        ? createDocumentSyncResponse()
        : createDocumentCreateResponse();
      return HttpResponse.json(body);
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const createRequest = createDocumentCreateRequest();
  const syncRequest = createDocumentSyncRequest();

  expect(await client.createDocument(createRequest)).not.toBeNull();
  expect(await client.syncDocument("document-1", syncRequest)).not.toBeNull();

  expect(
    calls.map((call) => ({
      body: call.body,
      input: call.url,
      method: call.method,
    })),
  ).toEqual([
    {
      body: JSON.stringify(createRequest),
      input: `${apiBaseUrl}/documents`,
      method: "POST",
    },
    {
      body: JSON.stringify(syncRequest),
      input: `${apiBaseUrl}/documents/document-1/sync`,
      method: "POST",
    },
  ]);
});

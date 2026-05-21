import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import type {
  ContainerMutationRequest,
  CreateOrganizationGroupRequest,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentSyncRequest,
  PutPrincipalMemberEnvelopesRequest,
  PutPrincipalStateRequest,
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

function textStream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
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
    createdAt: "2026-05-06T18:00:00.000Z",
    organizationId: "organization-1",
    parentId: "parent-1",
    updatedAt: "2026-05-06T18:00:00.000Z",
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

function createContainerDeleteResponse() {
  return {
    containerId: "container-1",
    deletedAt: "2026-05-06T18:00:00.000Z",
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

function createPrincipalStateRequest(): PutPrincipalStateRequest {
  return {
    state: {
      principalType: "group",
      principalId: "550e8400-e29b-41d4-a716-446655440001",
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: "public-key",
      keyFingerprint: "key-fingerprint",
      membershipMode: "projection",
      membershipRoot: "membership-root",
      projectionRoot: "projection-root",
      payloadCiphertextHash: "ciphertext-hash",
      memberCount: 1,
      signedAt: "2026-05-12T12:00:00.000Z",
      signerUserId: "550e8400-e29b-41d4-a716-446655440002",
      signerUserKeyFingerprint: "signing-fingerprint",
      signature: "signature",
    },
    encryptedPayload: {
      cipherSuite: "aes-256-gcm",
      ciphertext: "ciphertext",
      ciphertextHash: "ciphertext-hash",
    },
    projection: [
      {
        memberPrincipalType: "user",
        memberPrincipalId: "550e8400-e29b-41d4-a716-446655440002",
        role: "admin",
      },
    ],
  };
}

function createPrincipalMemberEnvelopesRequest(): PutPrincipalMemberEnvelopesRequest {
  return {
    stateHash: "state-hash",
    envelopes: [
      {
        memberPrincipalType: "user",
        memberPrincipalId: "550e8400-e29b-41d4-a716-446655440002",
        memberKeyFingerprint: "member-fingerprint",
        kemCipherText: "kem-ciphertext",
        wrappedKey: "wrapped-key",
      },
    ],
  };
}

function createOrganizationGroupRequest(): CreateOrganizationGroupRequest {
  const stateRequest = createPrincipalStateRequest();

  return {
    groupId: stateRequest.state.principalId,
    name: "Operators",
    initialGroupPolicy: {
      ...stateRequest,
      memberEnvelopes: createPrincipalMemberEnvelopesRequest().envelopes,
    },
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

test("returns document sync failures without reporting when requested", async () => {
  server.use(
    http.post(`${apiBaseUrl}/documents/:documentId/sync`, () => {
      return HttpResponse.json(
        {
          error: "Document KEK targets are stale",
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

  const result = await client.syncDocumentResult(
    "document-1",
    createDocumentSyncRequest(),
    { reportErrors: false },
  );

  expect(result.ok).toBe(false);
  expect(errors).toEqual([]);
  if (result.ok) {
    throw new Error("Expected document sync result failure");
  }
  expect(result.status).toBe(409);
  expect(result.message).toBe(
    "POST /documents/document-1/sync: 409 Conflict: Document KEK targets are stale",
  );

  result.report();
  expect(errors).toEqual([
    "POST /documents/document-1/sync: 409 Conflict: Document KEK targets are stale",
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

test("deletes containers through the route namespace", async () => {
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

test("returns container delete failures without reporting when requested", async () => {
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

test("uses blob multipart stage route namespace", async () => {
  const calls: CapturedHttpCall[] = [];
  server.use(
    http.all(`${apiBaseUrl}/*`, async ({ request }) => {
      calls.push(await captureHttpCall(request));

      if (request.method === "GET") {
        return HttpResponse.json({
          byteLength: 12,
          completed: false,
          expiresAt: "2026-05-18T12:00:00.000Z",
          sha256: "sha256-1",
          stageId: "stage-1",
          uploadId: "upload-1",
          uploadedParts: [{ byteLength: 6, etag: "etag-1", partNumber: 1 }],
        });
      }
      if (request.method === "PUT") {
        return HttpResponse.json({
          part: { byteLength: 6, etag: "etag-1", partNumber: 1 },
          stageId: "stage-1",
          uploadId: "upload-1",
        });
      }
      if (request.url.endsWith("/complete")) {
        return HttpResponse.json({
          byteLength: 12,
          expiresAt: "2026-05-18T12:00:00.000Z",
          sha256: "sha256-1",
          stageId: "stage-1",
        });
      }

      return HttpResponse.json({
        byteLength: 12,
        expiresAt: "2026-05-18T12:00:00.000Z",
        sha256: "sha256-1",
        stageId: "stage-1",
        uploadId: "upload-1",
        uploadedParts: [],
      });
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const initiateRequest = { byteLength: 12, sha256: "sha256-1" };
  const partRequest = { encryptedBytes: "part-1", uploadId: "upload-1" };
  const streamedPartRequest = {
    byteLength: new TextEncoder().encode("part-2").byteLength,
    encryptedBytes: textStream("part-2"),
    sha256: "2bb41b3bc344d2a5c1f31d662d86d78d7e98198b1eef7be3209d4f85da4ef14d",
    uploadId: "upload-1",
  };
  const completeRequest = {
    parts: [{ etag: "etag-1", partNumber: 1 }],
    uploadId: "upload-1",
  };

  expect(
    await client.initiateMultipartBlobStage(initiateRequest),
  ).not.toBeNull();
  expect(await client.getMultipartBlobStage("stage-1")).not.toBeNull();
  expect(
    await client.uploadMultipartBlobPart("stage-1", 1, partRequest),
  ).not.toBeNull();
  expect(
    await client.uploadMultipartBlobPartBytes(
      "stage-1",
      2,
      streamedPartRequest,
    ),
  ).not.toBeNull();
  expect(
    await client.completeMultipartBlobStage("stage-1", completeRequest),
  ).not.toBeNull();

  expect(
    calls.map((call) => ({
      body: call.body,
      input: call.url,
      method: call.method,
    })),
  ).toEqual([
    {
      body: JSON.stringify(initiateRequest),
      input: `${apiBaseUrl}/blobs/stages/multipart`,
      method: "POST",
    },
    {
      body: null,
      input: `${apiBaseUrl}/blobs/stages/multipart/stage-1`,
      method: "GET",
    },
    {
      body: JSON.stringify(partRequest),
      input: `${apiBaseUrl}/blobs/stages/multipart/stage-1/parts/1`,
      method: "PUT",
    },
    {
      body: "part-2",
      input: `${apiBaseUrl}/blobs/stages/multipart/stage-1/parts/2/bytes`,
      method: "PUT",
    },
    {
      body: JSON.stringify(completeRequest),
      input: `${apiBaseUrl}/blobs/stages/multipart/stage-1/complete`,
      method: "POST",
    },
  ]);
  expect(calls[3]?.contentType).toBe("application/octet-stream");
});

test("streams blob downloads from the bytes route", async () => {
  const calls: CapturedHttpCall[] = [];
  server.use(
    http.get(`${apiBaseUrl}/blobs/blob-1/bytes`, async ({ request }) => {
      calls.push(await captureHttpCall(request));

      return HttpResponse.text("encrypted-blob-bytes", {
        headers: {
          "Content-Length": new TextEncoder()
            .encode("encrypted-blob-bytes")
            .byteLength.toString(),
          "X-Tearleads-Blob-Id": "blob-1",
          "X-Tearleads-Blob-Sha256": "sha256-1",
        },
      });
    }),
  );

  const client = new ApiClient(apiBaseUrl);

  await expect(client.getBlob("blob-1")).resolves.toEqual({
    blobId: "blob-1",
    encryptedBytes: "encrypted-blob-bytes",
    sha256: "sha256-1",
  });
  expect(
    calls.map((call) => ({
      body: call.body,
      input: call.url,
      method: call.method,
    })),
  ).toEqual([
    {
      body: null,
      input: `${apiBaseUrl}/blobs/blob-1/bytes`,
      method: "GET",
    },
  ]);
});

test("exposes streamed blob download responses", async () => {
  server.use(
    http.get(`${apiBaseUrl}/blobs/blob-1/bytes`, () => {
      const encryptedBytes = new TextEncoder().encode("encrypted-blob-bytes");

      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encryptedBytes);
            controller.close();
          },
        }),
        {
          headers: {
            "Content-Length": encryptedBytes.byteLength.toString(),
            "X-Tearleads-Blob-Id": "blob-1",
            "X-Tearleads-Blob-Sha256": "sha256-1",
          },
        },
      );
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const blob = await client.getBlobBytes("blob-1");

  expect(blob?.blobId).toBe("blob-1");
  expect(blob?.byteLength).toBe(20);
  expect(blob?.sha256).toBe("sha256-1");
  await expect(new Response(blob?.encryptedBytes).text()).resolves.toBe(
    "encrypted-blob-bytes",
  );
});

test("uses blob byte length header when content-length is unavailable", async () => {
  server.use(
    http.get(`${apiBaseUrl}/blobs/blob-1/bytes`, () => {
      const encryptedBytes = new TextEncoder().encode("encrypted-blob-bytes");

      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encryptedBytes);
            controller.close();
          },
        }),
        {
          headers: {
            "X-Tearleads-Blob-Byte-Length":
              encryptedBytes.byteLength.toString(),
            "X-Tearleads-Blob-Id": "blob-1",
            "X-Tearleads-Blob-Sha256": "sha256-1",
          },
        },
      );
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const blob = await client.getBlobBytes("blob-1");

  expect(blob?.byteLength).toBe(20);
  await expect(new Response(blob?.encryptedBytes).text()).resolves.toBe(
    "encrypted-blob-bytes",
  );
});

test("reports malformed blob byte responses", async () => {
  server.use(
    http.get(`${apiBaseUrl}/blobs/blob-1/bytes`, () => {
      return HttpResponse.text("encrypted-blob-bytes");
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const errors: string[] = [];
  client.setOnError((message) => {
    errors.push(message);
  });

  await expect(client.getBlob("blob-1")).resolves.toBeNull();
  expect(errors).toEqual([
    "Invalid response shape for /blobs/blob-1/bytes: missing x-tearleads-blob-id, x-tearleads-blob-sha256",
  ]);
});

test("uses organization manager and principal policy route namespaces", async () => {
  const calls: CapturedHttpCall[] = [];
  server.use(
    http.all(`${apiBaseUrl}/*`, async ({ request }) => {
      calls.push(await captureHttpCall(request));

      if (request.url.endsWith("/directory")) {
        return HttpResponse.json({
          organizationId: "org-1",
          currentUser: { isOrgAdmin: true },
          users: [],
        });
      }
      if (request.url.endsWith("/data-usage")) {
        return HttpResponse.json({
          organizationId: "org-1",
          blobs: {
            blobCount: 2,
            byteLength: 96,
          },
          documents: {
            byteLength: 32,
            documentCount: 1,
            updateCount: 2,
          },
          totalByteLength: 128,
        });
      }
      if (request.url.endsWith("/members")) {
        return HttpResponse.json({
          organizationId: "org-1",
          groupId: "group-1",
          members: [],
        });
      }
      if (request.url.endsWith("/containers")) {
        return HttpResponse.json({
          organizationId: "org-1",
          groupId: "group-1",
          containers: [
            {
              accessLevel: "admin",
              containerId: "container-1",
              createdAt: "2026-05-12T12:00:00.000Z",
              depth: 0,
              isBuiltin: false,
              metadataAccessEpoch: 1,
              metadataAccessStateHash: "access-state-hash",
              metadataDocumentId: "metadata-document-1",
              parentId: null,
              updatedAt: "2026-05-12T12:00:00.000Z",
            },
          ],
        });
      }
      if (request.url.endsWith("/grants")) {
        return HttpResponse.json({
          organizationId: "org-1",
          grants: [
            {
              accessLevel: "admin",
              containerId: "container-1",
              createdAt: "2026-05-12T12:00:00.000Z",
              depth: 0,
              isBuiltin: false,
              metadataAccessEpoch: 1,
              metadataAccessStateHash: "access-state-hash",
              metadataDocumentId: "metadata-document-1",
              parentId: null,
              updatedAt: "2026-05-12T12:00:00.000Z",
              subjectType: "group",
              subjectId: "group-1",
              userId: null,
              signingKeyFingerprint: null,
              groupId: "group-1",
              groupName: "Operators",
              organizationName: null,
            },
          ],
        });
      }
      if (request.url.endsWith("/users/user-1/detail")) {
        return HttpResponse.json({
          organizationId: "org-1",
          user: {
            userId: "user-1",
            signingKeyFingerprint: "signing-fingerprint",
            signingPublicKey: "signing-key",
            encapsulationPublicKey: "encapsulation-key",
            encapsulationKeyFingerprint: "encapsulation-fingerprint",
            createdAt: "2026-05-12T12:00:00.000Z",
            isSelf: true,
          },
          groups: [
            {
              groupId: "group-1",
              organizationId: "org-1",
              name: "Operators",
              createdAt: "2026-05-12T12:00:00.000Z",
              currentState: null,
            },
          ],
          grants: {
            directGrants: [],
            groupGrants: [
              {
                accessLevel: "admin",
                containerId: "container-1",
                createdAt: "2026-05-12T12:00:00.000Z",
                depth: 0,
                isBuiltin: false,
                metadataAccessEpoch: 1,
                metadataAccessStateHash: "access-state-hash",
                metadataDocumentId: "metadata-document-1",
                parentId: null,
                updatedAt: "2026-05-12T12:00:00.000Z",
                subjectType: "group",
                subjectId: "group-1",
                userId: null,
                signingKeyFingerprint: null,
                groupId: "group-1",
                groupName: "Operators",
                organizationName: null,
              },
            ],
            organizationGrants: [],
          },
        });
      }
      if (request.url.endsWith("/member-envelopes")) {
        return HttpResponse.json({
          principalType: "group",
          principalId: "group-1",
          stateHash: "state-hash",
          epoch: 1,
          envelopes: [],
        });
      }
      if (request.url.endsWith("/state")) {
        return HttpResponse.json({
          ...createPrincipalStateRequest().state,
          stateHash: "state-hash",
          createdAt: "2026-05-12T12:00:00.000Z",
        });
      }
      if (request.method === "POST") {
        return HttpResponse.json({
          groupId: "group-1",
          organizationId: "org-1",
          name: "Operators",
          createdAt: "2026-05-12T12:00:00.000Z",
          currentState: {
            stateHash: "state-hash",
            version: 1,
            keyEpoch: 1,
            memberCount: 1,
          },
        });
      }

      return HttpResponse.json({ organizationId: "org-1", groups: [] });
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const groupRequest = createOrganizationGroupRequest();
  const stateRequest = createPrincipalStateRequest();
  const envelopeRequest = createPrincipalMemberEnvelopesRequest();

  expect(await client.listOrganizationDirectory("org-1")).not.toBeNull();
  expect(await client.getOrganizationDataUsage("org-1")).not.toBeNull();
  expect(await client.listOrganizationGroups("org-1")).not.toBeNull();
  expect(await client.listOrganizationContainerGrants("org-1")).not.toBeNull();
  expect(
    await client.getOrganizationUserDetail("org-1", "user-1"),
  ).not.toBeNull();
  expect(
    await client.createOrganizationGroup("org-1", groupRequest),
  ).not.toBeNull();
  expect(
    await client.listOrganizationGroupMembers("org-1", "group-1"),
  ).not.toBeNull();
  expect(
    await client.listOrganizationGroupContainers("org-1", "group-1"),
  ).not.toBeNull();
  expect(
    await client.putPrincipalState("group", "group-1", stateRequest),
  ).not.toBeNull();
  expect(
    await client.putPrincipalMemberEnvelopes(
      "group",
      "group-1",
      envelopeRequest,
    ),
  ).not.toBeNull();

  expect(
    calls.map((call) => ({
      body: call.body,
      input: call.url,
      method: call.method,
    })),
  ).toEqual([
    {
      body: null,
      input: `${apiBaseUrl}/organizations/org-1/directory`,
      method: "GET",
    },
    {
      body: null,
      input: `${apiBaseUrl}/organizations/org-1/data-usage`,
      method: "GET",
    },
    {
      body: null,
      input: `${apiBaseUrl}/organizations/org-1/groups`,
      method: "GET",
    },
    {
      body: null,
      input: `${apiBaseUrl}/organizations/org-1/grants`,
      method: "GET",
    },
    {
      body: null,
      input: `${apiBaseUrl}/organizations/org-1/users/user-1/detail`,
      method: "GET",
    },
    {
      body: JSON.stringify(groupRequest),
      input: `${apiBaseUrl}/organizations/org-1/groups`,
      method: "POST",
    },
    {
      body: null,
      input: `${apiBaseUrl}/organizations/org-1/groups/group-1/members`,
      method: "GET",
    },
    {
      body: null,
      input: `${apiBaseUrl}/organizations/org-1/groups/group-1/containers`,
      method: "GET",
    },
    {
      body: JSON.stringify(stateRequest),
      input: `${apiBaseUrl}/principals/group/group-1/state`,
      method: "PUT",
    },
    {
      body: JSON.stringify(envelopeRequest),
      input: `${apiBaseUrl}/principals/group/group-1/member-envelopes`,
      method: "PUT",
    },
  ]);
});

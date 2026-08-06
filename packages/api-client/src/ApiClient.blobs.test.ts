import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  server,
  testApiClient,
  textStream,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const stageId = "11111111-1111-4111-8111-111111111111";
const blobId = "22222222-2222-4222-8222-222222222222";

testApiClient("uses blob multipart stage route namespace", async () => {
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
          stageId,
          uploadId: "upload-1",
          uploadedParts: [{ byteLength: 6, etag: "etag-1", partNumber: 1 }],
        });
      }
      if (request.method === "PUT") {
        return HttpResponse.json({
          part: { byteLength: 6, etag: "etag-1", partNumber: 1 },
          stageId,
          uploadId: "upload-1",
        });
      }
      if (request.url.endsWith("/complete")) {
        return HttpResponse.json({
          byteLength: 12,
          expiresAt: "2026-05-18T12:00:00.000Z",
          sha256: "sha256-1",
          stageId,
        });
      }

      return HttpResponse.json({
        byteLength: 12,
        expiresAt: "2026-05-18T12:00:00.000Z",
        sha256: "sha256-1",
        stageId,
        uploadId: "upload-1",
        uploadedParts: [],
      });
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const initiateRequest = { byteLength: 12, sha256: "sha256-1" };
  const encryptedPartBytes = new TextEncoder().encode("part-2");
  const partBytesRequest = {
    byteLength: encryptedPartBytes.byteLength,
    encryptedBytes: encryptedPartBytes,
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
  expect(await client.getMultipartBlobStage(stageId)).not.toBeNull();
  expect(
    await client.uploadMultipartBlobPartBytes(stageId, 1, partBytesRequest),
  ).not.toBeNull();
  expect(
    await client.completeMultipartBlobStage(stageId, completeRequest),
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
      input: `${apiBaseUrl}/blobs/stages/multipart/${stageId}`,
      method: "GET",
    },
    {
      body: "part-2",
      input: `${apiBaseUrl}/blobs/stages/multipart/${stageId}/parts/1/bytes`,
      method: "PUT",
    },
    {
      body: JSON.stringify(completeRequest),
      input: `${apiBaseUrl}/blobs/stages/multipart/${stageId}/complete`,
      method: "POST",
    },
  ]);
  expect(calls[2]?.contentType).toBe("application/octet-stream");
});

testApiClient(
  "retains the latest multipart request failure detail",
  async () => {
    server.use(
      http.put(
        `${apiBaseUrl}/blobs/stages/multipart/${stageId}/parts/2/bytes`,
        () =>
          HttpResponse.json(
            { error: "Blob sha256 does not match multipart upload" },
            { status: 409, statusText: "Conflict" },
          ),
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const encryptedPartBytes = new TextEncoder().encode("part-2");

    await expect(
      client.uploadMultipartBlobPartBytes(stageId, 2, {
        byteLength: encryptedPartBytes.byteLength,
        encryptedBytes: encryptedPartBytes,
        sha256:
          "2bb41b3bc344d2a5c1f31d662d86d78d7e98198b1eef7be3209d4f85da4ef14d",
        uploadId: "upload-1",
      }),
    ).resolves.toBeNull();
    expect(
      client.getRequestFailure({
        method: "PUT",
        path: `/blobs/stages/multipart/${stageId}/parts/2/bytes`,
      })?.message,
    ).toBe(
      `PUT /blobs/stages/multipart/${stageId}/parts/2/bytes: 409 Conflict: Blob sha256 does not match multipart upload`,
    );
  },
);

testApiClient("exposes streamed blob download responses", async () => {
  server.use(
    http.get(`${apiBaseUrl}/blobs/${blobId}/bytes`, () => {
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
            "X-Tearleads-Blob-Id": blobId,
            "X-Tearleads-Blob-Sha256": "sha256-1",
          },
        },
      );
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const blob = await client.getBlobBytes(blobId);

  expect(blob?.blobId).toBe(blobId);
  expect(blob?.byteLength).toBe(20);
  expect(blob?.sha256).toBe("sha256-1");
  await expect(new Response(blob?.encryptedBytes).text()).resolves.toBe(
    "encrypted-blob-bytes",
  );
});

testApiClient(
  "uses blob byte length header when content-length is unavailable",
  async () => {
    server.use(
      http.get(`${apiBaseUrl}/blobs/${blobId}/bytes`, () => {
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
              "X-Tearleads-Blob-Id": blobId,
              "X-Tearleads-Blob-Sha256": "sha256-1",
            },
          },
        );
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const blob = await client.getBlobBytes(blobId);

    expect(blob?.byteLength).toBe(20);
    await expect(new Response(blob?.encryptedBytes).text()).resolves.toBe(
      "encrypted-blob-bytes",
    );
  },
);

testApiClient("reports malformed blob byte responses", async () => {
  server.use(
    http.get(`${apiBaseUrl}/blobs/${blobId}/bytes`, () => {
      return HttpResponse.text("encrypted-blob-bytes");
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const errors: string[] = [];
  client.setOnError((message) => {
    errors.push(message);
  });

  await expect(client.getBlobBytes(blobId)).resolves.toBeNull();
  expect(errors).toEqual([
    `Invalid response shape for /blobs/${blobId}/bytes: missing X-Tearleads-Blob-Id, X-Tearleads-Blob-Sha256`,
  ]);
});

testApiClient(
  "groups alternative blob byte length headers in malformed responses",
  async () => {
    server.use(
      http.get(`${apiBaseUrl}/blobs/${blobId}/bytes`, () => {
        return new Response(textStream("encrypted-blob-bytes"));
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const errors: string[] = [];
    client.setOnError((message) => {
      errors.push(message);
    });

    await expect(client.getBlobBytes(blobId)).resolves.toBeNull();
    expect(errors).toEqual([
      `Invalid response shape for /blobs/${blobId}/bytes: missing X-Tearleads-Blob-Id, (X-Tearleads-Blob-Byte-Length or Content-Length), X-Tearleads-Blob-Sha256`,
    ]);
  },
);

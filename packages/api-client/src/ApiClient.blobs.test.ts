import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import { ApiClient } from "./ApiClient";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  server,
  testApiClient,
  textStream,
} from "./ApiClient.testHarness";

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

testApiClient("streams blob downloads from the bytes route", async () => {
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

testApiClient("exposes streamed blob download responses", async () => {
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

testApiClient(
  "uses blob byte length header when content-length is unavailable",
  async () => {
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
  },
);

testApiClient("reports malformed blob byte responses", async () => {
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

testApiClient(
  "groups alternative blob byte length headers in malformed responses",
  async () => {
    server.use(
      http.get(`${apiBaseUrl}/blobs/blob-1/bytes`, () => {
        return new Response(textStream("encrypted-blob-bytes"));
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const errors: string[] = [];
    client.setOnError((message) => {
      errors.push(message);
    });

    await expect(client.getBlob("blob-1")).resolves.toBeNull();
    expect(errors).toEqual([
      "Invalid response shape for /blobs/blob-1/bytes: missing x-tearleads-blob-id, (x-tearleads-blob-byte-length or content-length), x-tearleads-blob-sha256",
    ]);
  },
);

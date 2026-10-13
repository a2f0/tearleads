import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
  textStream,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const blobId = "22222222-2222-4222-8222-222222222222";
const descriptorHandler = http.get(
  `${apiBaseUrl}/blobs/${blobId}/download`,
  () =>
    HttpResponse.json({
      blobId,
      byteLength: 20,
      sha256: "a".repeat(64),
      source: { kind: "api" },
    }),
);

testApiClient("exposes streamed blob download responses", async () => {
  server.use(
    descriptorHandler,
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
      descriptorHandler,
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
    descriptorHandler,
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
    `Invalid response headers for /blobs/${blobId}/bytes`,
  ]);
});

testApiClient(
  "groups alternative blob byte length headers in malformed responses",
  async () => {
    server.use(
      descriptorHandler,
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
      `Invalid response headers for /blobs/${blobId}/bytes`,
    ]);
  },
);

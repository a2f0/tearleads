import { expect } from "bun:test";
import { createHash } from "node:crypto";
import { MultipartBlobPartUploadRequestSchema } from "@tearleads/validators/operation";
import { MULTIPART_BLOB_STAGE_ERROR_CODES } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const stageId = "11111111-1111-4111-8111-111111111111";

function useMemoryPartUpload() {
  server.use(
    http.post<{ stageId: string; partNumber: string }>(
      `${apiBaseUrl}/blobs/stages/multipart/:stageId/parts/:partNumber/upload`,
      async ({ request, params }) =>
        HttpResponse.json({
          ...MultipartBlobPartUploadRequestSchema.parse(await request.json()),
          stageId: params.stageId,
          partNumber: Number(params.partNumber),
          source: { kind: "api" },
        }),
    ),
  );
}

testApiClient("uses blob multipart stage route namespace", async () => {
  const calls: CapturedHttpCall[] = [];
  let uploadHeaders: Record<string, string | null> | undefined;
  server.use(
    http.all(`${apiBaseUrl}/*`, async ({ request }) => {
      calls.push(await captureHttpCall(request));

      if (request.method === "GET") {
        return HttpResponse.json({
          byteLength: 12,
          completed: false,
          organizationId: "organization-1",
          expiresAt: "2026-05-18T12:00:00.000Z",
          sha256: "sha256-1",
          stageId,
          uploadId: "upload-1",
          uploadedParts: [{ byteLength: 6, etag: "etag-1", partNumber: 1 }],
        });
      }
      if (request.method === "PUT") {
        uploadHeaders = {
          byteLength: request.headers.get("X-Tearleads-Blob-Part-Byte-Length"),
          sha256: request.headers.get("X-Tearleads-Blob-Part-Sha256"),
          uploadId: request.headers.get("X-Tearleads-Blob-Upload-Id"),
        };
        return HttpResponse.json({
          part: { byteLength: 6, etag: "etag-1", partNumber: 1 },
          stageId,
          uploadId: "upload-1",
        });
      }
      if (request.url.endsWith("/complete")) {
        return HttpResponse.json({
          byteLength: 12,
          organizationId: "organization-1",
          expiresAt: "2026-05-18T12:00:00.000Z",
          sha256: "sha256-1",
          stageId,
        });
      }

      return HttpResponse.json({
        byteLength: 12,
        organizationId: "organization-1",
        expiresAt: "2026-05-18T12:00:00.000Z",
        sha256: "sha256-1",
        stageId,
        uploadId: "upload-1",
        uploadedParts: [],
      });
    }),
  );

  useMemoryPartUpload();
  const client = new ApiClient(apiBaseUrl);
  const initiateRequest = {
    organizationId: "organization-1",
    byteLength: 12,
    sha256: "sha256-1",
  };
  const encryptedPartBytes = new TextEncoder().encode("part-2");
  const encryptedPartBlob = new Blob([encryptedPartBytes]);
  const partBytesRequest = {
    byteLength: encryptedPartBytes.byteLength,
    encryptedBytes: encryptedPartBlob,
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
  expect(uploadHeaders).toEqual({
    byteLength: String(encryptedPartBytes.byteLength),
    sha256: "2bb41b3bc344d2a5c1f31d662d86d78d7e98198b1eef7be3209d4f85da4ef14d",
    uploadId: "upload-1",
  });
});

testApiClient(
  "keeps multipart Blob sources intact until encoding",
  async () => {
    const encryptedBytes = new Blob(["encrypted-part"]);
    useMemoryPartUpload();
    const client = new ApiClient(apiBaseUrl);
    let capturedBody: Blob | BufferSource | undefined;
    const transport = Reflect.get(client, "transport");

    expect(
      Reflect.set(
        transport,
        "requestBinaryRequest",
        async (
          _operation: unknown,
          input: { readonly body: Blob | BufferSource },
          options: {
            readonly encodeBody: (body: Blob | BufferSource) => BodyInit;
          },
        ) => {
          capturedBody = input.body;
          expect(options.encodeBody(input.body)).toBeInstanceOf(File);
          return null;
        },
      ),
    ).toBe(true);

    await client.uploadMultipartBlobPartBytes(stageId, 1, {
      byteLength: encryptedBytes.size,
      encryptedBytes,
      sha256: createHash("sha256").update("encrypted-part").digest("hex"),
      uploadId: "upload-1",
    });

    expect(capturedBody).toBe(encryptedBytes);
  },
);

testApiClient("retains coded multipart stage lookup failures", async () => {
  server.use(
    http.get(`${apiBaseUrl}/blobs/stages/multipart/${stageId}`, () =>
      HttpResponse.json(
        {
          code: MULTIPART_BLOB_STAGE_ERROR_CODES.notFound,
          error: "Blob stage not found",
        },
        { status: 404, statusText: "Not Found" },
      ),
    ),
  );

  useMemoryPartUpload();
  const client = new ApiClient(apiBaseUrl);

  await expect(client.getMultipartBlobStage(stageId)).resolves.toBeNull();
  expect(
    client.getRequestFailure({
      method: "GET",
      path: `/blobs/stages/multipart/${stageId}`,
    }),
  ).toMatchObject({
    code: MULTIPART_BLOB_STAGE_ERROR_CODES.notFound,
    kind: "http",
    status: 404,
  });
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

    useMemoryPartUpload();
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

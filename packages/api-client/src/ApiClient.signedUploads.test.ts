import { expect } from "bun:test";
import { createHash } from "node:crypto";
import { MultipartBlobPartUploadRequestSchema } from "@tearleads/validators/operation";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import { uploadMultipartBlobPartBytes } from "./routes/blobs/multipartUpload";

const stageId = "11111111-1111-4111-8111-111111111111";
const partPath = `/blobs/stages/multipart/${stageId}/parts/1/upload`;
const storagePath = "https://storage.test/part";
const bytes = new Uint8Array([0, 255, 128, 17]);
const request = {
  byteLength: bytes.byteLength,
  encryptedBytes: bytes,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  uploadId: "upload-1",
};
const descriptor = {
  byteLength: request.byteLength,
  contentMd5: createHash("md5").update(bytes).digest("base64"),
  partNumber: 1,
  stageId,
  uploadId: request.uploadId,
  source: {
    kind: "signed-url" as const,
    url: `${storagePath}?signature=secret`,
    expiresAt: "2026-10-13T12:05:00.000Z",
  },
};

// What a stage initiation issued for part 1, still well within its lifetime.
function issuedSource() {
  return {
    ...descriptor.source,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  };
}

for (const invalid of [
  { byteLength: bytes.length + 1 },
  { sha256: "0".repeat(64) },
]) {
  testApiClient(
    `reports invalid local part ${Object.keys(invalid)[0]} before authorization`,
    async () => {
      let authorizations = 0;
      server.use(
        http.post(`${apiBaseUrl}${partPath}`, () => {
          authorizations += 1;
          return HttpResponse.json(descriptor);
        }),
      );
      const client = new ApiClient(apiBaseUrl);
      const messages: string[] = [];
      client.setOnError((message) => messages.push(message));
      expect(
        await client.uploadMultipartBlobPartBytes(stageId, 1, {
          ...request,
          ...invalid,
        }),
      ).toBeNull();
      expect(authorizations).toBe(0);
      expect(messages).toHaveLength(1);
      expect(
        client.getRequestFailure({ method: "POST", path: partPath }),
      ).toMatchObject({ kind: "shape", status: null });
    },
  );
}

testApiClient(
  "snapshots the exact buffer view before authorizing a part",
  async () => {
    const backing = new Uint8Array([99, ...bytes, 99]);
    const view = backing.subarray(1, -1);
    server.use(
      http.post(`${apiBaseUrl}${partPath}`, () => {
        backing.fill(0);
        return HttpResponse.json(descriptor);
      }),
      http.put(storagePath, async ({ request }) => {
        expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes);
        return new HttpResponse(null, { headers: { ETag: "part-etag" } });
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    expect(
      await client.uploadMultipartBlobPartBytes(stageId, 1, {
        ...request,
        encryptedBytes: view,
      }),
    ).toMatchObject({ part: { etag: "part-etag" } });
  },
);

testApiClient(
  "signed uploads preserve binary File bodies and isolate storage credentials",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("session-secret");
    server.use(
      http.post(`${apiBaseUrl}${partPath}`, async ({ request }) => {
        expect(request.headers.get("Authorization")).toBe(
          "Bearer session-secret",
        );
        expect(await request.json()).toEqual({
          byteLength: bytes.length,
          contentMd5: descriptor.contentMd5,
          uploadId: "upload-1",
        });
        return HttpResponse.json(descriptor);
      }),
    );
    let storageCalls = 0;
    const uploaded = await uploadMultipartBlobPartBytes(
      Reflect.get(client, "transport"),
      stageId,
      1,
      request,
      async (url, init) => {
        storageCalls += 1;
        expect(url).toBe(descriptor.source.url);
        expect(init).toEqual({
          method: "PUT",
          body: expect.any(File),
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-MD5": descriptor.contentMd5,
          },
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
        });
        expect(
          new Uint8Array(await new Response(init.body).arrayBuffer()),
        ).toEqual(bytes);
        return new Response(null, { headers: { ETag: '"part-etag"' } });
      },
    );
    expect(storageCalls).toBe(1);
    expect(uploaded).toEqual({
      stageId,
      uploadId: "upload-1",
      part: { byteLength: bytes.length, partNumber: 1, etag: '"part-etag"' },
    });
  },
);

for (const firstFailure of [
  "expired",
  "network",
  "throttled",
  "server",
] as const) {
  testApiClient(
    `renews a ${firstFailure} upload URL for the same immutable part`,
    async () => {
      let authorizations = 0;
      const uploadedUrls: string[] = [];
      server.use(
        http.post(`${apiBaseUrl}${partPath}`, () =>
          HttpResponse.json({
            ...descriptor,
            source: {
              ...descriptor.source,
              url: `${storagePath}?signature=${++authorizations}`,
            },
          }),
        ),
        http.put(storagePath, async ({ request }) => {
          uploadedUrls.push(request.url);
          expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes);
          if (uploadedUrls.length === 1)
            return firstFailure === "network"
              ? HttpResponse.error()
              : new HttpResponse(null, {
                  status:
                    firstFailure === "expired"
                      ? 403
                      : firstFailure === "throttled"
                        ? 429
                        : 503,
                });
          return new HttpResponse(null, { headers: { ETag: "part-etag" } });
        }),
      );
      const client = new ApiClient(apiBaseUrl);
      let offlineSignals = 0;
      client.setOnNetworkError(() => {
        offlineSignals += 1;
      });
      expect(
        await client.uploadMultipartBlobPartBytes(stageId, 1, request),
      ).toMatchObject({
        stageId,
        uploadId: "upload-1",
        part: { partNumber: 1, etag: "part-etag" },
      });
      expect(authorizations).toBe(2);
      expect(uploadedUrls).toEqual([
        `${storagePath}?signature=1`,
        `${storagePath}?signature=2`,
      ]);
      expect(offlineSignals).toBe(0);
    },
  );
}

for (const override of [
  { stageId: "22222222-2222-4222-8222-222222222222" },
  { uploadId: "other-upload" },
  { partNumber: 2 },
  { byteLength: 3 },
  { contentMd5: "AAAAAAAAAAAAAAAAAAAAAA==" },
]) {
  testApiClient(
    `rejects mismatched upload descriptor ${Object.keys(override)[0]} before storage`,
    async () => {
      let storageCalls = 0;
      server.use(
        http.post(`${apiBaseUrl}${partPath}`, () =>
          HttpResponse.json({ ...descriptor, ...override }),
        ),
        http.put(storagePath, () => {
          storageCalls += 1;
          return new HttpResponse(null, { headers: { ETag: "part-etag" } });
        }),
      );
      const client = new ApiClient(apiBaseUrl);
      expect(
        await client.uploadMultipartBlobPartBytes(stageId, 1, request),
      ).toBeNull();
      expect(storageCalls).toBe(0);
      expect(
        client.getRequestFailure({ method: "POST", path: partPath }),
      ).toMatchObject({ kind: "shape", status: 200 });
    },
  );
}

for (const status of [200, 400, 403, 404, 429, 500, 503, null]) {
  testApiClient(
    `reports storage failure ${status} without leaking URLs or marking API offline`,
    async () => {
      let authorizations = 0;
      let storageCalls = 0;
      server.use(
        http.post(`${apiBaseUrl}${partPath}`, () => {
          authorizations += 1;
          return HttpResponse.json(descriptor);
        }),
        http.put(storagePath, () => {
          storageCalls += 1;
          return status === null
            ? HttpResponse.error()
            : new HttpResponse(descriptor.source.url, { status });
        }),
      );
      const client = new ApiClient(apiBaseUrl);
      const messages: string[] = [];
      let offlineSignals = 0;
      client.setOnNetworkError(() => {
        offlineSignals += 1;
      });
      client.setOnError((message) => messages.push(message));
      expect(
        await client.uploadMultipartBlobPartBytes(stageId, 1, request),
      ).toBeNull();
      const attempts =
        status === null || status === 403 || status === 429 || status >= 500
          ? 2
          : 1;
      expect(authorizations).toBe(attempts);
      expect(storageCalls).toBe(attempts);
      expect(messages).toHaveLength(1);
      expect(messages[0]).not.toContain("secret");
      expect(messages[0]).not.toContain(storagePath);
      if (status === 200)
        expect(messages[0]).toContain("ETag; check storage CORS");
      expect(offlineSignals).toBe(0);
      expect(
        client.getRequestFailure({ method: "POST", path: partPath }),
      ).toMatchObject({ kind: "storage", status });
    },
  );
}

testApiClient(
  "denied renewal stops the part without using an API byte fallback",
  async () => {
    let authorizations = 0;
    let storageCalls = 0;
    let proxyCalls = 0;
    server.use(
      http.post(`${apiBaseUrl}${partPath}`, () =>
        ++authorizations === 1
          ? HttpResponse.json(descriptor)
          : HttpResponse.json({ error: "Forbidden" }, { status: 403 }),
      ),
      http.put(storagePath, () => {
        storageCalls += 1;
        return new HttpResponse(null, { status: 403 });
      }),
      http.put(
        `${apiBaseUrl}/blobs/stages/multipart/${stageId}/parts/1/bytes`,
        () => {
          proxyCalls += 1;
          return HttpResponse.json({});
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    expect(
      await client.uploadMultipartBlobPartBytes(stageId, 1, request),
    ).toBeNull();
    expect(authorizations).toBe(2);
    expect(storageCalls).toBe(1);
    expect(proxyCalls).toBe(0);
    expect(
      client.getRequestFailure({ method: "POST", path: partPath }),
    ).toMatchObject({ kind: "http", status: 403 });
  },
);

testApiClient(
  "each chunk obtains its own URL while earlier part ETags stay valid",
  async () => {
    const calls: number[] = [];
    server.use(
      http.post<{ partNumber: string }>(
        `${apiBaseUrl}/blobs/stages/multipart/${stageId}/parts/:partNumber/upload`,
        async ({ request, params }) => {
          const partNumber = Number(params.partNumber);
          calls.push(partNumber);
          return HttpResponse.json({
            ...MultipartBlobPartUploadRequestSchema.parse(await request.json()),
            stageId,
            partNumber,
            source: {
              ...descriptor.source,
              url: `${storagePath}?partNumber=${partNumber}&signature=fresh-${partNumber}`,
            },
          });
        },
      ),
      http.put(
        storagePath,
        ({ request }) =>
          new HttpResponse(null, {
            headers: {
              ETag: `etag-${new URL(request.url).searchParams.get("partNumber")}`,
            },
          }),
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    const first = await client.uploadMultipartBlobPartBytes(
      stageId,
      1,
      request,
    );
    const second = await client.uploadMultipartBlobPartBytes(
      stageId,
      2,
      request,
    );
    expect(calls).toEqual([1, 2]);
    expect(first).toMatchObject({
      uploadId: "upload-1",
      part: { etag: "etag-1", partNumber: 1 },
    });
    expect(second).toMatchObject({
      uploadId: "upload-1",
      part: { etag: "etag-2", partNumber: 2 },
    });
  },
);

testApiClient(
  "an initiation-issued part URL is used without an authorization request",
  async () => {
    let authorizations = 0;
    server.use(
      http.post(`${apiBaseUrl}${partPath}`, () => {
        authorizations += 1;
        return HttpResponse.json(descriptor);
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    const urls: string[] = [];
    const uploaded = await uploadMultipartBlobPartBytes(
      Reflect.get(client, "transport"),
      stageId,
      1,
      { ...request, source: issuedSource() },
      async (url) => {
        urls.push(url);
        return new Response(null, { headers: { ETag: "issued-etag" } });
      },
    );
    expect(uploaded).toMatchObject({ part: { etag: "issued-etag" } });
    expect(urls).toEqual([descriptor.source.url]);
    expect(authorizations).toBe(0);
  },
);

testApiClient(
  "an expired initiation-issued part URL is renewed once",
  async () => {
    let authorizations = 0;
    const renewed = `${storagePath}?signature=renewed`;
    server.use(
      http.post(`${apiBaseUrl}${partPath}`, () => {
        authorizations += 1;
        return HttpResponse.json({
          ...descriptor,
          source: { ...descriptor.source, url: renewed },
        });
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    const urls: string[] = [];
    const uploaded = await uploadMultipartBlobPartBytes(
      Reflect.get(client, "transport"),
      stageId,
      1,
      { ...request, source: issuedSource() },
      async (url) => {
        urls.push(url);
        return url === renewed
          ? new Response(null, { headers: { ETag: "renewed-etag" } })
          : new Response(null, { status: 403 });
      },
    );
    expect(uploaded).toMatchObject({ part: { etag: "renewed-etag" } });
    expect(urls).toEqual([descriptor.source.url, renewed]);
    expect(authorizations).toBe(1);
  },
);

testApiClient(
  "an issued part URL that has lapsed in the queue is not spent on a 403",
  async () => {
    let authorizations = 0;
    server.use(
      http.post(`${apiBaseUrl}${partPath}`, () => {
        authorizations += 1;
        return HttpResponse.json(descriptor);
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    const urls: string[] = [];
    const uploaded = await uploadMultipartBlobPartBytes(
      Reflect.get(client, "transport"),
      stageId,
      1,
      {
        ...request,
        source: {
          ...descriptor.source,
          url: `${storagePath}?signature=lapsed`,
          expiresAt: new Date(Date.now() + 10_000).toISOString(),
        },
      },
      async (url) => {
        urls.push(url);
        return new Response(null, { headers: { ETag: "fresh-etag" } });
      },
    );
    expect(uploaded).toMatchObject({ part: { etag: "fresh-etag" } });
    expect(urls).toEqual([descriptor.source.url]);
    expect(authorizations).toBe(1);
  },
);

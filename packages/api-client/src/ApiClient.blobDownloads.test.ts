import { expect, mock, spyOn } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import { ApiRequestMetrics } from "./apiRequestMetrics";

const blobId = "22222222-2222-4222-8222-222222222222";
const downloadPath = `${apiBaseUrl}/blobs/${blobId}/download`;
const storageUrl = "https://storage.test/private-object?signature=secret";
const descriptor = {
  blobId,
  byteLength: 5,
  sha256: "a".repeat(64),
  source: {
    kind: "signed-url",
    url: storageUrl,
    expiresAt: "2026-01-01T00:00:00.000Z",
  },
};

testApiClient(
  "authenticates the descriptor and fetches storage without application credentials",
  async () => {
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("session-secret");
    server.use(
      http.get(downloadPath, ({ request }) => {
        expect(request.headers.get("Authorization")).toBe(
          "Bearer session-secret",
        );
        return HttpResponse.json(descriptor);
      }),
      http.get("https://storage.test/private-object", ({ request }) => {
        expect(request.url).toBe(storageUrl);
        // Header smoke checks; signedDownload.test.ts verifies fetch options.
        expect(request.headers.get("Authorization")).toBeNull();
        expect(request.headers.get("Cookie")).toBeNull();
        expect(request.signal.aborted).toBe(false);
        return HttpResponse.text("bytes");
      }),
    );
    const blob = await client.getBlobBytes(blobId);
    expect(blob).toMatchObject({
      blobId,
      byteLength: 5,
      sha256: descriptor.sha256,
    });
    await expect(new Response(blob?.encryptedBytes).text()).resolves.toBe(
      "bytes",
    );
  },
);

for (const failure of ["forbidden", "network"] as const) {
  testApiClient(`refreshes a ${failure} storage response once`, async () => {
    let authorizations = 0;
    let downloads = 0;
    server.use(
      http.get(downloadPath, () => {
        authorizations += 1;
        return HttpResponse.json({
          ...descriptor,
          source: {
            ...descriptor.source,
            url: `${storageUrl}&attempt=${authorizations}`,
          },
        });
      }),
      http.get("https://storage.test/private-object", ({ request }) => {
        downloads += 1;
        expect(new URL(request.url).searchParams.get("attempt")).toBe(
          String(downloads),
        );
        if (downloads === 1)
          return failure === "network"
            ? HttpResponse.error()
            : new HttpResponse(null, { status: 403 });
        return HttpResponse.text("bytes");
      }),
    );
    const blob = await new ApiClient(apiBaseUrl).getBlobBytes(blobId);
    await expect(new Response(blob?.encryptedBytes).text()).resolves.toBe(
      "bytes",
    );
    expect(authorizations).toBe(2);
    expect(downloads).toBe(2);
  });
}

testApiClient(
  "a forbidden fallback stops without leaking URLs or marking the API offline",
  async () => {
    let authorizations = 0;
    let downloads = 0;
    const errors: string[] = [];
    let networkErrors = 0;
    const client = new ApiClient(apiBaseUrl);
    client.setOnError((message) => errors.push(message));
    client.setOnNetworkError(() => {
      networkErrors += 1;
    });
    server.use(
      http.get(downloadPath, () => {
        authorizations += 1;
        return HttpResponse.json(descriptor);
      }),
      http.get("https://storage.test/private-object", () => {
        downloads += 1;
        return HttpResponse.error();
      }),
      http.get(`${apiBaseUrl}/blobs/${blobId}/bytes`, () =>
        HttpResponse.json({ error: "Forbidden" }, { status: 403 }),
      ),
    );
    expect(await client.getBlobBytes(blobId)).toBeNull();
    expect(authorizations).toBe(2);
    expect(downloads).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("403");
    expect(errors.join(" ")).not.toContain("signature=secret");
    expect(networkErrors).toBe(0);
    expect(
      client.getRequestFailure({
        method: "GET",
        path: `/blobs/${blobId}/bytes`,
      }),
    ).toMatchObject({ kind: "http", status: 403 });
  },
);

testApiClient(
  "stops when authorization is revoked before URL refresh",
  async () => {
    let authorizations = 0;
    let downloads = 0;
    server.use(
      http.get(downloadPath, () => {
        authorizations += 1;
        return authorizations === 1
          ? HttpResponse.json(descriptor)
          : HttpResponse.json({ error: "Forbidden" }, { status: 403 });
      }),
      http.get("https://storage.test/private-object", () => {
        downloads += 1;
        return new HttpResponse(null, { status: 403 });
      }),
    );
    expect(await new ApiClient(apiBaseUrl).getBlobBytes(blobId)).toBeNull();
    expect(authorizations).toBe(2);
    expect(downloads).toBe(1);
  },
);

testApiClient(
  "rejects mismatched blob descriptors before contacting storage",
  async () => {
    let storageRequests = 0;
    let streamRequests = 0;
    const client = new ApiClient(apiBaseUrl);
    server.use(
      http.get(downloadPath, () =>
        HttpResponse.json({
          ...descriptor,
          blobId: "33333333-3333-4333-8333-333333333333",
        }),
      ),
      http.get("https://storage.test/private-object", () => {
        storageRequests += 1;
        return HttpResponse.text("bytes");
      }),
      http.get(`${apiBaseUrl}/blobs/${blobId}/bytes`, () => {
        streamRequests += 1;
        return new HttpResponse("bytes", {
          headers: {
            "X-Tearleads-Blob-Id": blobId,
            "X-Tearleads-Blob-Byte-Length": "5",
            "X-Tearleads-Blob-Sha256": descriptor.sha256,
          },
        });
      }),
    );
    expect(await client.getBlobBytes(blobId)).toBeNull();
    expect(storageRequests).toBe(0);
    expect(streamRequests).toBe(0);
    expect(
      client.getRequestFailure({
        method: "GET",
        path: `/blobs/${blobId}/download`,
      }),
    ).toMatchObject({ kind: "shape", status: 200 });
  },
);

testApiClient(
  "a buffer-only host refuses a bounded download before any HTTP request",
  async () => {
    const network = mock(() => HttpResponse.text("unexpected request"));
    server.use(
      http.get(downloadPath, network),
      http.get("https://storage.test/private-object", network),
      http.get(`${apiBaseUrl}/blobs/${blobId}/bytes`, network),
    );
    expect(
      await new ApiClient(apiBaseUrl).getBlobBytes(blobId, {
        maxEncryptedByteLength: 20,
      }),
    ).toBeNull();
    expect(network).not.toHaveBeenCalled();
  },
);

testApiClient(
  "bounded downloads cancel a streaming API error before collecting its details",
  async () => {
    const cancel = mock(() => {});
    let pulls = 0;
    const network = spyOn(globalThis, "fetch");
    network.mockResolvedValueOnce(
      Response.json({ ...descriptor, source: { kind: "api" } }),
    );
    network.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              if (++pulls === 1) controller.enqueue(new Uint8Array(65537));
              else controller.close();
            },
            cancel,
          },
          { highWaterMark: 0 },
        ),
        { status: 500 },
      ),
    );
    try {
      const client = new ApiClient(apiBaseUrl, {
        metrics: new ApiRequestMetrics(),
        getIdentity: () => null,
        streamingDownloads: true,
      });
      expect(
        await client.getBlobBytes(blobId, { maxEncryptedByteLength: 20 }),
      ).toBeNull();
      expect(pulls).toBe(1);
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      network.mockRestore();
    }
  },
);

testApiClient(
  "a descriptor exceeding the metadata limit counts as an invalid response",
  async () => {
    const client = new ApiClient(apiBaseUrl, {
      metrics: new ApiRequestMetrics(),
      getIdentity: () => null,
      streamingDownloads: true,
    });
    const offline = mock(() => {});
    client.setOnNetworkError(offline);
    server.use(
      http.get(downloadPath, () =>
        HttpResponse.json({ ...descriptor, extra: "x".repeat(65537) }),
      ),
    );
    expect(
      await client.getBlobBytes(blobId, { maxEncryptedByteLength: 20 }),
    ).toBeNull();
    expect(
      client.getRequestFailure({
        method: "GET",
        path: `/blobs/${blobId}/download`,
      }),
    ).toMatchObject({ kind: "json" });
    expect(offline).not.toHaveBeenCalled();
  },
);

testApiClient(
  "an unexpected descriptor status releases its unread stream",
  async () => {
    const cancel = mock(() => {});
    const network = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), {
        status: 206,
      }),
    );
    try {
      const client = new ApiClient(apiBaseUrl, {
        metrics: new ApiRequestMetrics(),
        getIdentity: () => null,
        streamingDownloads: true,
      });
      expect(
        await client.getBlobBytes(blobId, { maxEncryptedByteLength: 20 }),
      ).toBeNull();
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      network.mockRestore();
    }
  },
);

for (const kind of ["attachment listing", "writer projection"] as const)
  testApiClient(
    `a bounded ${kind} cancels an oversized stream before decoding`,
    async () => {
      const cancel = mock(() => {});
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls++;
            if (pulls <= 10) controller.enqueue(new Uint8Array(1024 * 1024));
            else controller.close();
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      const network = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(body),
      );
      try {
        const client = new ApiClient(apiBaseUrl, {
          metrics: new ApiRequestMetrics(),
          getIdentity: () => null,
          streamingDownloads: true,
        });
        expect(
          kind === "attachment listing"
            ? await client.listDocumentAttachments(crypto.randomUUID(), {
                boundedListing: true,
              })
            : await client.getDocumentWriterProjection(crypto.randomUUID(), {
                signal: new AbortController().signal,
              }),
        ).toBeNull();
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(pulls).toBe(9);
      } finally {
        network.mockRestore();
      }
    },
  );

testApiClient(
  "a bounded verifier read with an invalid descriptor preserves shared download diagnostics",
  async () => {
    const client = new ApiClient(apiBaseUrl, {
      metrics: new ApiRequestMetrics(),
      getIdentity: () => null,
      streamingDownloads: true,
    });
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let calls = 0;
    server.use(
      http.get(downloadPath, async () => {
        if (++calls === 1) {
          started.resolve();
          await release.promise;
          return HttpResponse.json({
            ...descriptor,
            blobId: crypto.randomUUID(),
          });
        }
        return HttpResponse.json(descriptor);
      }),
      http.get("https://storage.test/private-object", () =>
        HttpResponse.text("bytes"),
      ),
    );
    const older = client.getBlobBytes(blobId, {
      maxEncryptedByteLength: 10,
      signal: new AbortController().signal,
    });
    try {
      await started.promise;
      const newer = await client.getBlobBytes(blobId);
      expect(await new Response(newer?.encryptedBytes).text()).toBe("bytes");
    } finally {
      release.resolve();
    }
    expect(await older).toBeNull();
    expect(
      client.getRequestFailure({
        method: "GET",
        path: `/blobs/${blobId}/download`,
      }),
    ).toBeNull();
  },
);

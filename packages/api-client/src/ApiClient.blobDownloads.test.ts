import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

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
  "bounds repeated failures and never reports the bearer URL",
  async () => {
    let authorizations = 0;
    let downloads = 0;
    const errors: string[] = [];
    const client = new ApiClient(apiBaseUrl);
    client.setOnError((message) => errors.push(message));
    server.use(
      http.get(downloadPath, () => {
        authorizations += 1;
        return HttpResponse.json(descriptor);
      }),
      http.get("https://storage.test/private-object", () => {
        downloads += 1;
        return HttpResponse.error();
      }),
    );
    expect(await client.getBlobBytes(blobId)).toBeNull();
    expect(authorizations).toBe(2);
    expect(downloads).toBe(2);
    expect(errors).toEqual([`Blob ${blobId} download failed (network error)`]);
    expect(errors.join(" ")).not.toContain("signature=secret");
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
    server.use(
      http.get(downloadPath, () =>
        HttpResponse.json({
          ...descriptor,
          blobId: "33333333-3333-4333-8333-333333333333",
        }),
      ),
    );
    expect(await new ApiClient(apiBaseUrl).getBlobBytes(blobId)).toBeNull();
  },
);

for (const status of [404, 500]) {
  testApiClient(
    `reports storage HTTP ${status} without refreshing or leaking response text`,
    async () => {
      let authorizations = 0;
      const errors: string[] = [];
      const client = new ApiClient(apiBaseUrl);
      client.setOnError((message) => errors.push(message));
      server.use(
        http.get(downloadPath, () => {
          authorizations += 1;
          return HttpResponse.json(descriptor);
        }),
        http.get(
          "https://storage.test/private-object",
          () => new HttpResponse(storageUrl, { status }),
        ),
      );
      expect(await client.getBlobBytes(blobId)).toBeNull();
      expect(authorizations).toBe(1);
      expect(errors).toEqual([
        `Blob ${blobId} download failed (HTTP ${status})`,
      ]);
      expect(
        client.getRequestFailure({
          method: "GET",
          path: `/blobs/${blobId}/download`,
        }),
      ).toMatchObject({ kind: "http", status });
    },
  );
}

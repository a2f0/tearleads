import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const blobId = "22222222-2222-4222-8222-222222222222";
const storageUrl = "https://storage.test/object?signature=secret";

for (const failure of ["network", 403, 404, 500, "old-api"] as const) {
  testApiClient(
    `falls back to an authenticated stream after ${failure}`,
    async () => {
      let downloads = 0;
      let authorizations = 0;
      let fallbacks = 0;
      let networkErrors = 0;
      const errors: string[] = [];
      const client = new ApiClient(apiBaseUrl);
      client.setAuthToken("session-secret");
      client.setOnError((message) => errors.push(message));
      client.setOnNetworkError(() => {
        networkErrors += 1;
      });
      server.use(
        http.get(`${apiBaseUrl}/blobs/${blobId}/download`, () => {
          authorizations += 1;
          if (failure === "old-api")
            return HttpResponse.json({ error: "Not found" }, { status: 404 });
          return HttpResponse.json({
            blobId,
            byteLength: 5,
            sha256: "a".repeat(64),
            source: {
              kind: "signed-url",
              url: storageUrl,
              expiresAt: "2026-01-01T00:00:00.000Z",
            },
          });
        }),
        http.get("https://storage.test/object", () => {
          downloads += 1;
          return failure === "network" || failure === "old-api"
            ? HttpResponse.error()
            : new HttpResponse(null, { status: failure });
        }),
        http.get(`${apiBaseUrl}/blobs/${blobId}/bytes`, ({ request }) => {
          fallbacks += 1;
          expect(request.headers.get("Authorization")).toBe(
            "Bearer session-secret",
          );
          return new HttpResponse("bytes", {
            headers: {
              "X-Tearleads-Blob-Id": blobId,
              "X-Tearleads-Blob-Byte-Length": "5",
              "X-Tearleads-Blob-Sha256": "a".repeat(64),
            },
          });
        }),
      );
      const result = await client.getBlobBytes(blobId);
      expect(result).not.toBeNull();
      await expect(new Response(result?.encryptedBytes).text()).resolves.toBe(
        "bytes",
      );
      const attempts = failure === "network" || failure === 403 ? 2 : 1;
      expect(authorizations).toBe(attempts);
      expect(downloads).toBe(failure === "old-api" ? 0 : attempts);
      expect(fallbacks).toBe(1);
      expect(errors).toEqual([]);
      expect(networkErrors).toBe(0);
    },
  );
}

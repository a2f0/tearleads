import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const segment = {
  authorityKind: "direct" as const,
  endCounter: 4,
  peerId: "peer-1",
  startCounter: 0,
  writerKeyFingerprint: "fingerprint-1",
  writerUserId: "user-1",
};
const compact = {
  attributionRevision: 1,
  documentId: "document-1",
  segments: [segment],
  truncated: false,
};
const ranges = {
  attributionRevision: 1,
  documentId: "document-1",
  hasMore: false,
  items: [{ ...segment, updateId: "update-1" }],
  nextCursor: null,
};

const cacheHeaders: Record<string, string>[] = [
  // Older servers let CORS overwrite this header before response finalization.
  { "Cache-Control": "private, no-cache", Vary: "Origin" },
  { "Cache-Control": "private, no-cache", Vary: "accept-encoding" },
  { "Cache-Control": "private, no-cache", Vary: "Origin, Accept-Encoding" },
  { "Cache-Control": "no-cache, private", Vary: "Accept-Encoding" },
  { "Cache-Control": "private, no-cache, no-store", Vary: "*" },
  { "Cache-Control": "private, no-cache" },
  { Vary: "Origin, Accept-Encoding" },
  {},
];

for (const headers of cacheHeaders) {
  testApiClient(
    `attribution accepts HTTP cache metadata ${JSON.stringify(headers)}`,
    async () => {
      server.use(
        http.get(`${apiBaseUrl}/documents/:documentId/attribution`, () =>
          HttpResponse.json(compact, {
            headers: { ...headers, ETag: 'W/"attribution-1"' },
          }),
        ),
        http.get(`${apiBaseUrl}/documents/:documentId/attribution/ranges`, () =>
          HttpResponse.json(ranges, { headers }),
        ),
      );
      const errors: string[] = [];
      const client = new ApiClient(apiBaseUrl);
      client.setOnError((message) => errors.push(message));
      expect(await client.getDocumentEditAttribution("document-1")).toEqual(
        compact,
      );
      expect(
        await client.listDocumentEditAttributionRanges("document-1"),
      ).toEqual(ranges);
      expect(errors).toEqual([]);
    },
  );
}

testApiClient("attribution 304 tolerates omitted cache metadata", async () => {
  server.use(
    http.get(
      `${apiBaseUrl}/documents/:documentId/attribution`,
      () =>
        new HttpResponse(null, {
          headers: { ETag: 'W/"attribution-1"' },
          status: 304,
        }),
    ),
  );
  const errors: string[] = [];
  const client = new ApiClient(apiBaseUrl);
  client.setOnError((message) => errors.push(message));
  expect(await client.getDocumentEditAttribution("document-1")).toBeNull();
  expect(errors).toEqual([]);
});

testApiClient("attribution still requires ETag and valid data", async () => {
  server.use(
    http.get(`${apiBaseUrl}/documents/:documentId/attribution`, () =>
      HttpResponse.json(compact),
    ),
  );
  const errors: string[] = [];
  const client = new ApiClient(apiBaseUrl);
  client.setOnError((message) => errors.push(message));
  expect(await client.getDocumentEditAttribution("document-1")).toBeNull();
  expect(errors[0]).toContain("Invalid response headers");
  server.use(
    http.get(`${apiBaseUrl}/documents/:documentId/attribution`, () =>
      HttpResponse.json(
        { ...compact, attributionRevision: -1 },
        { headers: { ETag: 'W/"attribution-1"' } },
      ),
    ),
  );
  expect(await client.getDocumentEditAttribution("document-1")).toBeNull();
  expect(errors[1]).toContain("Invalid response shape");
});

testApiClient(
  "attribution recovers from a failed read on the next request",
  async () => {
    let requests = 0;
    server.use(
      http.get(`${apiBaseUrl}/documents/:documentId/attribution`, () => {
        requests += 1;
        return requests === 1
          ? HttpResponse.json({ error: "Unavailable" }, { status: 503 })
          : HttpResponse.json(compact, {
              headers: {
                "Cache-Control": "private, no-cache",
                ETag: 'W/"attribution-1"',
                Vary: "Accept-Encoding",
              },
            });
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    expect(await client.getDocumentEditAttribution("document-1")).toBeNull();
    expect(await client.getDocumentEditAttribution("document-1")).toEqual(
      compact,
    );
    expect(requests).toBe(2);
  },
);

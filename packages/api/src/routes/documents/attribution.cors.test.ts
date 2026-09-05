import { expect, test } from "bun:test";
import {
  getDocumentAttributionOperation,
  listDocumentAttributionRangesOperation,
} from "@tearleads/validators/operation";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import type { SessionEnv } from "../../middleware/session";
import { createDocumentAttributionRoute } from "./attribution";

function createApp() {
  const app = new Hono<SessionEnv>();
  app.use("*", cors({ origin: ["https://app.example.test"] }));
  app.route(
    "/",
    createDocumentAttributionRoute({
      loadAttribution: async () => ({
        attributionRevision: 1,
        json: JSON.stringify({
          attributionRevision: 1,
          documentId: "document-1",
          segments: [],
          truncated: false,
        }),
      }),
      listAttributionRanges: async () => ({
        attributionRevision: 1,
        documentId: "document-1",
        hasMore: false,
        items: [],
        nextCursor: null,
      }),
      prepareAttribution: async () => ({
        attributionRevision: 1,
        attributionScope: "incarnation:access-state",
        documentId: "document-1",
        documentIncarnation: "incarnation",
      }),
      requireAuth: async (c, next) => {
        c.set("session", {
          createdAt: 0,
          fingerprint: "fingerprint-1",
          id: "session-1",
          ipAddresses: [],
          lastActiveAt: 0,
          lastActiveIp: null,
          userId: "user-1",
        });
        return next();
      },
      runtime: createServiceTestRuntime(),
    }),
  );
  return app;
}

test("compact, detailed, and revalidated attribution preserve CORS cache variation", async () => {
  const app = createApp();
  const headers = { Origin: "https://app.example.test" };
  const compact = await app.request("/documents/document-1/attribution", {
    headers,
  });
  const ranges = await app.request("/documents/document-1/attribution/ranges", {
    headers,
  });
  const revalidated = await app.request("/documents/document-1/attribution", {
    headers: {
      ...headers,
      "If-None-Match": compact.headers.get("ETag") ?? "",
    },
  });
  expect([compact.status, ranges.status, revalidated.status]).toEqual([
    200, 200, 304,
  ]);
  for (const [response, schema] of [
    [compact, getDocumentAttributionOperation.responseHeaders[200]],
    [ranges, listDocumentAttributionRangesOperation.responseHeaders[200]],
    [revalidated, getDocumentAttributionOperation.responseHeaders[304]],
  ] as const) {
    expect(response.headers.get("Vary"), `status ${response.status}`).toBe(
      "Origin, Accept-Encoding",
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
    const values: Record<string, string> = {};
    for (const name of Object.keys(schema.shape)) {
      const value = response.headers.get(name);
      if (value !== null) values[name] = value;
    }
    expect(schema.safeParse(values).success).toBe(true);
  }
});

import { expect, spyOn, test } from "bun:test";
import { AccessDenied, NoSuchKey } from "@aws-sdk/client-s3";
import { createServerDiagnostics } from "@tearleads/diagnostics/server";

test.each([
  [AccessDenied, 403, "object storage access denied"],
  [NoSuchKey, 404, "object storage object missing"],
] as const)(
  "AWS %p failures retain safe details without storage identifiers",
  async (Exception, status, label) => {
    const secret = "SYNTHETIC_PRIVATE_BUCKET_KEY_REQUEST_ID";
    const error = new Exception({
      message: secret,
      $metadata: { httpStatusCode: status, requestId: secret },
    });
    const requests: RequestInit[] = [];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (_url: unknown, init?: RequestInit) => {
          requests.push(init ?? {});
          return new Response(null, { status: 200 });
        },
        { preconnect: () => {} },
      ),
    );
    const client = createServerDiagnostics({
      dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
      environment: "staging",
      release: `tearleads-api@${"b".repeat(40)}`,
      dist: "staging",
      origin: "",
      scriptPath: "",
      runtime: "api",
      serverSourceRoot: "/synthetic-build",
      scriptPaths: new Set(),
    });
    try {
      client.captureError(error, "background-error", "blob.maintenance");
      await client.flush();
      expect(requests).toHaveLength(1);
      const body = String(requests[0]?.body);
      expect(body).not.toContain(secret);
      const event = JSON.parse(body.trim().split("\n")[2] ?? "{}");
      expect(event.tags).toMatchObject({
        api_error_code: error.name,
        api_error_status: String(status),
      });
      expect(event.exception.values[0].value).toBe(
        `API blob maintenance failed: ${label} (${error.name}) [HTTP ${status}]`,
      );
    } finally {
      await client.close();
      fetchSpy.mockRestore();
    }
  },
);

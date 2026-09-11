import { afterEach, expect, spyOn, test } from "bun:test";
import { createBrowserDiagnostics } from "@tearleads/diagnostics/browser";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { LogProvider, useLog } from "./LogProvider";

afterEach(cleanup);

for (const platform of ["web", "android", "ios"] as const) {
  test(`${platform} handled quarantine emits a private, deduplicated Sentry event`, async () => {
    const requests: RequestInit[] = [];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (...args: Parameters<typeof fetch>) => {
          requests.push(args[1] ?? {});
          return new Response(null, { status: 200 });
        },
        { preconnect: () => {} },
      ),
    );
    const origin =
      platform === "web" ? "https://app.tearleads.com" : "https://localhost";
    const scriptPath =
      platform === "web" ? "/chunk-test.js" : "/assets/index-test.js";
    const diagnostics = createBrowserDiagnostics({
      dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
      origin,
      scriptPath,
      environment: "production",
      release: `tearleads-${platform}@${"b".repeat(40)}`,
      dist: "production-app",
    });
    const secret = "SYNTHETIC_PRIVATE_QUARANTINE_VALUE";
    const error = new Error(`Document sync quarantined: ${secret}`, {
      cause: new Error(secret),
    });
    Object.assign(error, {
      name: "DocumentSyncUpdateIsolationError",
      stage: "loro_import",
      updateId: secret,
      documentId: secret,
      writerUserId: secret,
      authorFingerprint: secret,
    });
    // A compiled application frame, as recorded by the web/native reporters.
    error.stack = `Error: ${secret}\n    at quarantine (${origin}${scriptPath}:42:9)`;
    function Harness() {
      const { logError } = useLog();
      return (
        <button
          type="button"
          onClick={() => logError("Documents: sync updates quarantined", error)}
        >
          Report
        </button>
      );
    }
    try {
      const view = render(
        <LogProvider diagnostics={diagnostics}>
          <Harness />
        </LogProvider>,
      );
      fireEvent.click(view.getByText("Report"));
      fireEvent.click(view.getByText("Report"));
      await diagnostics.flush();
      expect(requests).toHaveLength(1);
      const body = String(requests[0]?.body);
      expect(body).not.toContain(secret);
      const event = JSON.parse(body.trim().split("\n")[2] ?? "{}");
      expect(event.tags.diagnostic_source).toBe("log");
      expect(event.release).toBe(`tearleads-${platform}@${"b".repeat(40)}`);
      expect(event.exception.values[0]).toEqual({
        type: "Error",
        value: "Application error (message omitted)",
        mechanism: { type: "generic", handled: true },
        stacktrace: {
          frames: [
            {
              filename: `app://${scriptPath}`,
              lineno: 42,
              colno: 9,
              in_app: true,
            },
          ],
        },
      });
      expect(event.extra).toBeUndefined();
      expect(event.request).toBeUndefined();
      expect(event.user).toEqual({ ip_address: "0.0.0.0" });
    } finally {
      await diagnostics.dispose();
      fetchSpy.mockRestore();
    }
  });
}

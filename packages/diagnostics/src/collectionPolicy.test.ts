import { expect, spyOn, test } from "bun:test";
import { type Client, type LogEnvelope, Scope } from "@sentry/core";
import { createBrowserDiagnostics } from "./browser";
import type { SentryConfig } from "./config";
import { createServerDiagnostics } from "./server";

test("both private clients deny Sentry's expanded collection defaults", async () => {
  const clients: Client[] = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(async () => new Response(null, { status: 200 }), {
      preconnect: () => {},
    }),
  );
  const original = Scope.prototype.setClient;
  const scopeSpy = spyOn(Scope.prototype, "setClient").mockImplementation(
    function (this: Scope, client: Client | undefined) {
      if (client) clients.push(client);
      original.call(this, client);
    },
  );
  const hadWindow = Object.hasOwn(globalThis, "window");
  const previousWindow = globalThis.window;
  globalThis.window = Object.assign(Object.create(null), {
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  const config: SentryConfig = {
    dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
    environment: "staging" as const,
    release: `tearleads-web@${"b".repeat(40)}`,
    dist: "staging",
    origin: "https://app.tearleads.com",
    scriptPath: "/index.js",
  };
  const browser = createBrowserDiagnostics(config);
  const server = createServerDiagnostics(config);
  try {
    server.captureError(new Error("SYNTHETIC_POLICY_CHECK"), "request-error");
    expect(clients).toHaveLength(2);
    for (const client of clients) {
      expect(client.getOptions().dataCollection).toEqual({
        userInfo: false,
        cookies: false,
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        urlQueryParams: false,
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        queues: false,
        graphQL: { document: false, variables: false },
        stackFrameVariables: false,
        frameContextLines: 0,
      });
      expect(client.getOptions().integrations).toEqual([]);
      expect(client.getIntegrationByName("SpanStreaming")).toBeUndefined();
      expect(client.getOptions().sendClientReports).toBe(false);
      expect(client.getOptions().traceLifecycle).toBe("static");
      expect(client.getOptions().tracesSampleRate).toBe(0);
    }
    await server.flush();
    const requestsBeforeLog = fetchSpy.mock.calls.length;
    const logEnvelope: LogEnvelope = [
      { sent_at: new Date().toISOString() },
      [
        [
          {
            type: "log",
            item_count: 1,
            content_type: "application/vnd.sentry.items.log+json",
          },
          {
            items: [
              {
                timestamp: Date.now() / 1000,
                level: "info",
                body: "SYNTHETIC_PRIVATE_LOG",
              },
            ],
          },
        ],
      ],
    ];
    for (const client of clients) {
      const transport = client.getTransport();
      expect(transport).toBeDefined();
      await transport?.send(logEnvelope);
    }
    expect(fetchSpy.mock.calls).toHaveLength(requestsBeforeLog);
  } finally {
    await browser.dispose();
    await server.close();
    scopeSpy.mockRestore();
    fetchSpy.mockRestore();
    if (hadWindow) globalThis.window = previousWindow;
    else Reflect.deleteProperty(globalThis, "window");
  }
});

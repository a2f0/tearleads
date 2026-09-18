import { expect, spyOn, test } from "bun:test";
import { createServerDiagnostics } from "@tearleads/diagnostics/server";
import { StripeApiError } from "../billing/stripeHttp";

test.each([false, true])(
  "Stripe failures retain their safe type (wrapped: %p)",
  async (wrapped) => {
    const secret = "SYNTHETIC_PRIVATE_STRIPE_OPERATION";
    const failure = new StripeApiError(secret, 429);
    const error = wrapped ? new Error(secret, { cause: failure }) : failure;
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
      client.captureError(error, "background-error", "billing.seat-sync");
      await client.flush();
      expect(requests).toHaveLength(1);
      const body = String(requests[0]?.body);
      expect(body).not.toContain(secret);
      const event = JSON.parse(body.trim().split("\n")[2] ?? "{}");
      expect(event.tags.api_error_status).toBe("429");
      expect(event.exception.values[0].value).toBe(
        "API Stripe seat synchronization failed [HTTP 429]",
      );
      if (wrapped) expect(event.tags.api_cause_type).toBe("StripeApiError");
      else expect(event.exception.values[0].type).toBe("StripeApiError");
    } finally {
      await client.close();
      fetchSpy.mockRestore();
    }
  },
);

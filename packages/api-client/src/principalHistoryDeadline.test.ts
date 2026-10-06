import { expect } from "bun:test";
import {
  getPrincipalPolicyOperation,
  isGetPrincipalPolicyOperationResponse,
  putPrincipalPolicyOperation,
} from "@tearleads/validators/operation";
import { http, passthrough } from "msw";
import { createPrincipalPolicyBundleResponse } from "../test/helpers/apiClientTestFactories";
import {
  server as mockServer,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { principalPolicyPageResponse } from "../test/helpers/principalPolicyPage";
import { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";

function allowLoopback() {
  mockServer.use(http.all(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()));
}

for (const method of ["GET", "PUT"] as const) {
  testApiClient(
    `${method} principal response timeout releases the request without an automatic replay`,
    async () => {
      allowLoopback();
      let requests = 0;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch() {
          requests += 1;
          await Bun.sleep(350);
          return Response.json({});
        },
      });
      const runtime = new ApiRequestRuntime(server.url.origin);
      try {
        const result = await principalHistoryRequest(runtime, {
          method,
          path: "/principal",
          requestTimeoutMs: 100,
          operation:
            method === "GET"
              ? getPrincipalPolicyOperation
              : putPrincipalPolicyOperation,
          validator: (value): value is Record<string, unknown> =>
            typeof value === "object" && value !== null,
          options: { reportErrors: false },
        });
        expect(result).toMatchObject({
          ok: false,
          kind: method === "GET" ? "cancelled" : "outcome-unknown",
          code:
            method === "GET"
              ? "principal_history_request_timed_out"
              : "principal_history_outcome_unknown",
        });
        expect(requests).toBe(1);
      } finally {
        await server.stop(true);
      }
    },
  );
}

testApiClient(
  "forward preparation progress gets a new response deadline every round",
  async () => {
    allowLoopback();
    let calls = 0;
    const bundle = createPrincipalPolicyBundleResponse();
    const page = principalPolicyPageResponse(bundle);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch() {
        calls += 1;
        await Bun.sleep(40);
        return calls <= 4
          ? Response.json(
              {
                code: "principal_history_preparation_pending",
                committed: false,
                progressToken: calls.toString(16).padStart(64, "0"),
              },
              { status: 202 },
            )
          : Response.json(page);
      },
    });
    try {
      const result = await principalHistoryRequest(
        new ApiRequestRuntime(server.url.origin),
        {
          method: "GET",
          path: "/principal",
          requestTimeoutMs: 150,
          operation: getPrincipalPolicyOperation,
          validator: isGetPrincipalPolicyOperationResponse,
          options: { reportErrors: false },
        },
      );
      expect(result).toEqual({ ok: true, data: page });
      expect(calls).toBe(5);
    } finally {
      await server.stop(true);
    }
  },
);

testApiClient(
  "a response body cannot outlive its principal request deadline",
  async () => {
    allowLoopback();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("{"));
              timer = setTimeout(() => controller.close(), 350);
            },
            cancel() {
              clearTimeout(timer);
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    });
    try {
      const result = await principalHistoryRequest(
        new ApiRequestRuntime(server.url.origin),
        {
          method: "GET",
          path: "/principal",
          requestTimeoutMs: 100,
          operation: getPrincipalPolicyOperation,
          validator: isGetPrincipalPolicyOperationResponse,
          options: { reportErrors: false },
        },
      );
      expect(result).toMatchObject({
        ok: false,
        code: "principal_history_request_timed_out",
      });
    } finally {
      clearTimeout(timer);
      await server.stop(true);
    }
  },
);

testApiClient(
  "caller cancellation keeps its own reason under a request deadline",
  async () => {
    allowLoopback();
    const controller = new AbortController();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch() {
        controller.abort();
        await Bun.sleep(350);
        return Response.json({});
      },
    });
    try {
      const result = await principalHistoryRequest(
        new ApiRequestRuntime(server.url.origin),
        {
          method: "GET",
          path: "/principal",
          requestTimeoutMs: 1_000,
          operation: getPrincipalPolicyOperation,
          validator: isGetPrincipalPolicyOperationResponse,
          options: { signal: controller.signal, reportErrors: false },
        },
      );
      expect(result).toMatchObject({
        ok: false,
        kind: "cancelled",
        code: "principal_history_context_changed",
      });
    } finally {
      await server.stop(true);
    }
  },
);

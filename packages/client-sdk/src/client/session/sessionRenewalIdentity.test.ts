import { expect, test } from "bun:test";
import type { ApiClient } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import {
  quietLogger,
  setGeneratedIdentity,
} from "../../../test/helpers/clientTestSupport";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { Tearleads } from "../Tearleads";

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

// Keys swapped without clearing the session make the renewal login a different
// user; that login must not replay a request the expired session sent.
for (const expiredUserId of [userA, null]) {
  for (const swapKeys of [false, true]) {
    test(`session renewal preserves its known user (user=${expiredUserId}, swap=${swapKeys})`, async () => {
      const { close, execSql } = await createTestExecSql(
        "session-renewal-identity",
      );
      const previousFetch = globalThis.fetch;
      const deletes: (string | null)[] = [];
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      globalThis.fetch = (async (input, init) => {
        const url = new URL(String(input));
        const authorization = new Headers(init?.headers).get("authorization");
        if (url.pathname === "/containers/target") {
          deletes.push(authorization);
          if (authorization !== "Bearer token-a")
            return jsonResponse({
              containerId: "target",
              deletedAt: "2026-10-10T00:00:00.000Z",
            });
          entered.resolve();
          await release.promise;
          return jsonResponse(
            {
              code: SESSION_ERROR_CODES.refreshRequired,
              error: "Session expired",
            },
            { status: 401, statusText: "Unauthorized" },
          );
        }
        if (url.pathname === "/auth/challenge")
          return jsonResponse({ challenge: "a".repeat(64) });
        if (url.pathname === "/auth/verify")
          return jsonResponse({
            rootContainerId: null,
            authenticated: true,
            isRoot: false,
            organizationId: "org",
            token: "token-renewed",
            userId: swapKeys ? userB : userA,
          });
        throw new Error(`Unexpected request ${init?.method} ${url.pathname}`);
      }) as typeof fetch;

      try {
        const sdk = new Tearleads({
          apiBaseUrl: "https://api.example.test",
          blobStoreFactory: () => createMemoryBlobStore(),
          database: { execSql, id: "session-renewal-identity" },
          logger: quietLogger,
        });
        await setGeneratedIdentity(sdk.identity);
        sdk.session.setContext({
          authToken: "token-a",
          defaultOrganizationId: "org",
          isAuthenticated: true,
          isRoot: false,
          rootAcknowledgments: [],
          organizationId: "org",
          userId: expiredUserId,
        });
        const api = Reflect.get(sdk, "apiClient") as ApiClient;
        const pending = api.deleteContainerResult("target", {
          reportErrors: false,
        });
        await entered.promise;
        // A host replaces the signing keys but leaves the old session in place.
        if (swapKeys) await setGeneratedIdentity(sdk.identity);
        release.resolve();
        const result = await pending;
        const canReplay = expiredUserId !== null && !swapKeys;
        expect(result.ok).toBe(canReplay);
        expect(deletes).toEqual(
          canReplay
            ? ["Bearer token-a", "Bearer token-renewed"]
            : ["Bearer token-a"],
        );
      } finally {
        globalThis.fetch = previousFetch;
        close();
      }
    });
  }
}

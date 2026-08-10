import { describe, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  quietLogger,
  setGeneratedIdentity,
} from "../../../test/helpers/clientTestSupport";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { Tearleads } from "../Tearleads";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("session expiry", () => {
  test("renews a restored stale auth token after session expiry", async () => {
    const { close, execSql } = await createTestExecSql(
      "session-expiry-identity-trust",
    );
    const previousFetch = globalThis.fetch;
    const requests: Array<{
      authorization: string | null;
      method: string | undefined;
      path: string;
    }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      const authorization = new Headers(init?.headers).get("authorization");
      requests.push({
        authorization,
        method: init?.method,
        path: url.pathname,
      });

      if (
        url.pathname === "/auth/sessions" &&
        authorization === "Bearer stale-token"
      ) {
        return jsonResponse(
          { error: "Session expired" },
          { status: 401, statusText: "Unauthorized" },
        );
      }

      if (url.pathname === "/auth/challenge") {
        return jsonResponse({ challenge: "a".repeat(64) });
      }

      if (url.pathname === "/auth/verify") {
        return jsonResponse({
          authenticated: true,
          organizationId: "org-2",
          token: "fresh-token",
          userId: "22222222-2222-4222-8222-222222222222",
        });
      }

      if (
        url.pathname === "/auth/sessions" &&
        authorization === "Bearer fresh-token"
      ) {
        return jsonResponse({ sessions: [] });
      }

      throw new Error(`Unexpected request ${init?.method} ${url.pathname}`);
    }) as typeof fetch;

    try {
      const sdk = new Tearleads({
        apiBaseUrl: "https://api.example.test",
        blobStoreFactory: () => createMemoryBlobStore(),
        database: { execSql, id: "session-expiry-identity-trust" },
        logger: quietLogger,
      });
      await setGeneratedIdentity(sdk.identity);
      sdk.session.setContext({
        authToken: "stale-token",
        defaultOrganizationId: "org-1",
        isAuthenticated: true,
        organizationId: "org-1",
        userId: "user-1",
      });

      await expect(sdk.session.listSessions()).resolves.toEqual([]);

      expect(sdk.session.snapshot).toEqual({
        authToken: "fresh-token",
        containerId: null,
        defaultOrganizationId: "org-2",
        isAuthenticated: true,
        organizationId: "org-2",
        userId: "22222222-2222-4222-8222-222222222222",
      });
      expect(requests).toEqual([
        {
          authorization: "Bearer stale-token",
          method: "GET",
          path: "/auth/sessions",
        },
        {
          authorization: "Bearer stale-token",
          method: "POST",
          path: "/auth/challenge",
        },
        {
          authorization: "Bearer stale-token",
          method: "POST",
          path: "/auth/verify",
        },
        {
          authorization: "Bearer fresh-token",
          method: "GET",
          path: "/auth/sessions",
        },
      ]);
    } finally {
      globalThis.fetch = previousFetch;
      close();
    }
  });
});

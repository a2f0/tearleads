import { describe, expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import type { Logger } from "./logger";
import { Tearleads } from "./Tearleads";

const quietLogger: Required<Logger> = {
  log: () => undefined,
  logError: () => undefined,
};

const account = {
  disabledAt: null,
  purgeAfter: null,
  purgeStartedAt: null,
  purgedAt: null,
  remoteDataEpoch: 1,
  status: "trialing" as const,
  trialEndsAt: "2026-06-08T00:00:00.000Z",
};

async function setGeneratedIdentity(sdk: Tearleads) {
  return sdk.identity.setKeyPairs({
    encapsulationKeyPair: generateKemSeedAndKeyPair(),
    signingKeyPair: generateSigningSeedAndKeyPair(),
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("session expiry", () => {
  test("renews a restored stale auth token after session expiry", async () => {
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
          account,
          authenticated: true,
          organizationId: "org-2",
          token: "fresh-token",
          userId: "user-2",
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
        logger: quietLogger,
      });
      await setGeneratedIdentity(sdk);
      sdk.session.setContext({
        authToken: "stale-token",
        isAuthenticated: true,
        organizationId: "org-1",
        userId: "user-1",
      });

      await expect(sdk.session.listSessions()).resolves.toEqual([]);

      expect(sdk.session.snapshot).toEqual({
        account,
        authToken: "fresh-token",
        containerId: null,
        isAuthenticated: true,
        organizationId: "org-2",
        userId: "user-2",
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
    }
  });
});

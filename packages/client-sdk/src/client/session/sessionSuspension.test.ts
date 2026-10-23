import { expect, test } from "bun:test";
import { AccountSuspendedError } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import {
  quietLogger,
  setGeneratedIdentity,
} from "../../../test/helpers/clientTestSupport";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { Tearleads } from "../../Tearleads";

const userId = "22222222-2222-4222-8222-222222222222";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

async function withSuspendedServer(
  run: (sdk: Tearleads, verifies: () => number) => Promise<void>,
): Promise<void> {
  const { close, execSql } = await createTestExecSql("session-suspension");
  const previousFetch = globalThis.fetch;
  let verifies = 0;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/sessions") {
      return jsonResponse(
        { code: SESSION_ERROR_CODES.refreshRequired, error: "Session expired" },
        { status: 401, statusText: "Unauthorized" },
      );
    }
    if (url.pathname === "/auth/challenge") {
      return jsonResponse({ challenge: "a".repeat(64) });
    }
    if (url.pathname === "/auth/verify") {
      verifies += 1;
      return jsonResponse(
        {
          authenticated: false,
          code: "account_suspended",
          error: "Account suspended",
        },
        { status: 403, statusText: "Forbidden" },
      );
    }
    throw new Error(`Unexpected request ${init?.method} ${url.pathname}`);
  }) as typeof fetch;

  try {
    const sdk = new Tearleads({
      apiBaseUrl: "https://api.example.test",
      blobStoreFactory: () => createMemoryBlobStore(),
      database: { execSql, id: "session-suspension" },
      logger: quietLogger,
    });
    await setGeneratedIdentity(sdk.identity);
    sdk.session.setContext({
      authToken: "stale-token",
      defaultOrganizationId: "org-1",
      isAuthenticated: true,
      isRoot: false,
      rootAcknowledgments: [],
      organizationId: "org-1",
      userId,
    });
    await run(sdk, () => verifies);
  } finally {
    globalThis.fetch = previousFetch;
    close();
  }
}

test("a suspended renewal signs out instead of renewing on every request", async () => {
  await withSuspendedServer(async (sdk, verifies) => {
    await expect(sdk.session.listSessions()).resolves.toEqual([]);
    expect(sdk.session.isAuthenticated).toBe(false);
    expect(sdk.session.authToken).toBeNull();

    await sdk.session.listSessions();
    expect(verifies()).toBe(1);
  });
});

test("a suspended login rejects with the typed reason and signs out", async () => {
  await withSuspendedServer(async (sdk, verifies) => {
    await expect(sdk.session.login()).rejects.toBeInstanceOf(
      AccountSuspendedError,
    );
    expect(sdk.session.isAuthenticated).toBe(false);
    expect(verifies()).toBe(1);
  });
});

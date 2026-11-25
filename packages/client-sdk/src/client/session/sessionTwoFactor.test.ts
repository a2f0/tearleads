import { expect, test } from "bun:test";
import { TwoFactorLoginError } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import {
  quietLogger,
  setGeneratedIdentity,
} from "../../../test/helpers/data/clientTestSupport";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { Tearleads } from "../../Tearleads";

const userId = "22222222-2222-4222-8222-222222222222";
const rememberedToken = "c".repeat(64);

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function refusal(code: string): Response {
  return jsonResponse(
    { authenticated: false, code, error: "Second factor needed" },
    { status: 401, statusText: "Unauthorized" },
  );
}

const renewed = () =>
  jsonResponse({
    authenticated: true,
    isRoot: false,
    organizationId: "org-1",
    rootContainerId: null,
    token: "token-renewed",
    userId,
    wsTicket: "ws-ticket",
  });

interface TwoFactorServer {
  readonly sdk: Tearleads;
  /** Each `/auth/verify` body, in order. */
  readonly verified: Record<string, unknown>[];
}

async function withTwoFactorServer(
  verify: () => Response | Promise<Response>,
  run: (server: TwoFactorServer) => Promise<void>,
): Promise<void> {
  const { close, execSql } = await createTestExecSql("session-two-factor");
  const previousFetch = globalThis.fetch;
  const verified: Record<string, unknown>[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    const authorization = new Headers(init?.headers).get("authorization");
    if (url.pathname === "/auth/sessions") {
      return authorization === "Bearer token-renewed"
        ? jsonResponse({ sessions: [] })
        : jsonResponse(
            { code: SESSION_ERROR_CODES.refreshRequired, error: "Expired" },
            { status: 401, statusText: "Unauthorized" },
          );
    }
    if (url.pathname === "/auth/challenge") {
      return jsonResponse({ challenge: "a".repeat(64) });
    }
    if (url.pathname === "/auth/verify") {
      verified.push(JSON.parse(String(init?.body)));
      return verify();
    }
    throw new Error(`Unexpected request ${init?.method} ${url.pathname}`);
  }) as typeof fetch;

  try {
    const sdk = new Tearleads({
      apiBaseUrl: "https://api.example.test",
      blobStoreFactory: () => createMemoryBlobStore(),
      database: { execSql, id: "session-two-factor" },
      logger: quietLogger,
    });
    await setGeneratedIdentity(sdk.identity);
    sdk.session.setContext({
      authToken: "stale-token",
      defaultOrganizationId: "org-1",
      isAuthenticated: true,
      isRoot: false,
      organizationId: "org-1",
      rootAcknowledgments: [],
      twoFactorDeviceToken: rememberedToken,
      userId,
    });
    await run({ sdk, verified });
  } finally {
    globalThis.fetch = previousFetch;
    close();
  }
}

test("silent renewal signs in with the remembered device's token", async () => {
  await withTwoFactorServer(renewed, async ({ sdk, verified }) => {
    await expect(sdk.session.listSessions()).resolves.toEqual([]);

    expect(verified).toEqual([
      expect.objectContaining({ twoFactorDeviceToken: rememberedToken }),
    ]);
    expect(verified[0]).not.toHaveProperty("twoFactor");
    expect(sdk.session.authToken).toBe("token-renewed");
    expect(sdk.session.snapshot.twoFactorDeviceToken).toBe(rememberedToken);
  });
});

test("a refused device token is forgotten and its renewal signs out", async () => {
  await withTwoFactorServer(
    () => refusal("two_factor_required"),
    async ({ sdk, verified }) => {
      await expect(sdk.session.listSessions()).resolves.toEqual([]);

      expect(sdk.session.isAuthenticated).toBe(false);
      expect(sdk.session.authToken).toBeNull();
      expect(sdk.session.snapshot.twoFactorDeviceToken).toBeNull();
      // The cleared session stops renewing: a second request asks nothing.
      await sdk.session.listSessions();
      expect(verified).toHaveLength(1);
    },
  );
});

test("a typed code wins over the device token, which a wrong code keeps", async () => {
  await withTwoFactorServer(
    () => refusal("two_factor_invalid"),
    async ({ sdk, verified }) => {
      const code = {
        code: "123456",
        method: "totp",
        rememberDevice: false,
      } as const;
      const error = await sdk.session
        .login(undefined, code)
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(TwoFactorLoginError);
      expect((error as TwoFactorLoginError).code).toBe("two_factor_invalid");
      expect(verified).toEqual([expect.objectContaining({ twoFactor: code })]);
      expect(verified[0]).not.toHaveProperty("twoFactorDeviceToken");
      expect(sdk.session.authToken).toBeNull();
      expect(sdk.session.snapshot.twoFactorDeviceToken).toBe(rememberedToken);
    },
  );
});

test("a refusal leaves a session another sign-in committed meanwhile", async () => {
  const held = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await withTwoFactorServer(
    async () => {
      held.resolve();
      await release.promise;
      return refusal("two_factor_required");
    },
    async ({ sdk }) => {
      const login = sdk.session.login();
      await held.promise;
      const otherToken = "d".repeat(64);
      sdk.session.setContext({
        authToken: "token-other",
        twoFactorDeviceToken: otherToken,
      });
      release.resolve();

      await expect(login).rejects.toBeInstanceOf(TwoFactorLoginError);
      expect(sdk.session.authToken).toBe("token-other");
      expect(sdk.session.isAuthenticated).toBe(true);
      expect(sdk.session.snapshot.twoFactorDeviceToken).toBe(otherToken);
    },
  );
});

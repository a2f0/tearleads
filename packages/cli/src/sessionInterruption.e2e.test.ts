import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import * as localDatabase from "./localDatabase";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { withSession } from "./session";

let apiBaseUrl = "";
let server: Bun.Server<undefined>;
let expireNextSessionList = false;
let dropIssuedReply = false;
// Requests matching `method pathname` get a 503 instead of reaching the API.
let failing: RegExp | null = null;
// Every `method pathname` the API received, in order.
const requests: string[] = [];
// Hooks the exact protocol request at which the test interrupts the command.
let onRequest: ((request: string) => void) | null = null;

beforeAll(async () => {
  await initializeApiDatabase();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const { pathname } = new URL(request.url);
      requests.push(`${request.method} ${pathname}`);
      onRequest?.(`${request.method} ${pathname}`);
      if (expireNextSessionList && pathname.endsWith("/sessions")) {
        expireNextSessionList = false;
        return Response.json(
          { code: "session_refresh_required", error: "Expired session" },
          { status: 401 },
        );
      }
      if (dropIssuedReply && pathname.endsWith("/auth/verify")) {
        await routeApp.fetch(request);
        return new Response("sign-in response lost", { status: 503 });
      }
      return failing?.test(`${request.method} ${pathname}`)
        ? new Response("unavailable", { status: 503 })
        : routeApp.fetch(request);
    },
  });
  apiBaseUrl = server.url.origin;
});

afterEach(() => {
  dropIssuedReply = false;
  failing = null;
  expireNextSessionList = false;
  onRequest = null;
});

afterAll(() => server?.stop(true));

test("stopping during key derivation never starts a login", async () => {
  const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
  requests.length = 0;
  let revoked: Promise<boolean> | undefined;
  await expect(
    withSession(
      {
        apiBaseUrl,
        recoveryKey: seedPhrase,
        registerShutdown: (stop) => {
          queueMicrotask(() => {
            revoked = stop();
          });
        },
      },
      async () => {
        throw new Error("Unexpected signed-in work");
      },
    ),
  ).rejects.toThrow("Command interrupted.");
  expect(await revoked).toBe(true);
  expect(requests.filter((request) => request.includes("/auth/"))).toEqual([]);
});

test("interruption reports unconfirmed revocation when the sign-in reply is lost", async () => {
  const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
  let stop: (() => Promise<boolean>) | undefined;
  let cleanup: Promise<boolean> | undefined;
  failing = /POST .*auth\/verify/u;
  onRequest = (request) => {
    if (failing?.test(request)) cleanup = stop?.();
  };
  await expect(
    withSession(
      {
        apiBaseUrl,
        recoveryKey: seedPhrase,
        registerShutdown: (revoke) => {
          stop = revoke;
        },
      },
      async () => {
        throw new Error("Unexpected signed-in work");
      },
    ),
  ).rejects.toThrow("Command interrupted.");
  expect(await cleanup).toBe(false);
});

test("an interrupt during the challenge prevents verification dispatch", async () => {
  const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
  let stop: (() => Promise<boolean>) | undefined;
  let cleanup: Promise<boolean> | undefined;
  requests.length = 0;
  onRequest = (request) => {
    if (request.includes("/auth/challenge")) cleanup = stop?.();
  };
  await expect(
    withSession(
      {
        apiBaseUrl,
        recoveryKey: seedPhrase,
        registerShutdown: (revoke) => {
          stop = revoke;
        },
      },
      async () => {
        throw new Error("Unexpected signed-in work");
      },
    ),
  ).rejects.toThrow("Command interrupted.");
  expect(await cleanup).toBe(true);
  expect(requests.some((request) => request.includes("/auth/verify"))).toBe(
    false,
  );
});

test("verification expiry during sign-in receives and revokes the issued token", async () => {
  const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
  const deadline = new AbortController();
  onRequest = (request) => {
    if (request.includes("/auth/verify")) deadline.abort();
  };
  await withSession(
    {
      apiBaseUrl,
      recoveryKey: seedPhrase,
      verificationDeadline: deadline.signal,
    },
    async ({ sdk }) => {
      expect(sdk.session.isAuthenticated).toBe(true);
    },
  );
  expect(requests.at(-1)).toContain("/auth/logout");
});

test("a lost verification reply without an interrupt reports the possible issued session", async () => {
  const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
  dropIssuedReply = true;
  await expect(
    withSession({ apiBaseUrl, recoveryKey: seedPhrase }, async () => {
      throw new Error("Unexpected work");
    }),
  ).rejects.toThrow("may have issued a session");
});

test("a one-session command reports expiry without reauthenticating", async () => {
  const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
  await expect(
    withSession(
      { apiBaseUrl, recoveryKey: seedPhrase, automaticSessionRenewal: false },
      async ({ sdk, assertNoFailures }) => {
        requests.length = 0;
        expireNextSessionList = true;
        await sdk.session.listSessions();
        assertNoFailures();
      },
    ),
  ).rejects.toThrow("failed 1 time");
  expect(
    requests.some(
      (request) =>
        request.includes("/auth/challenge") || request.includes("/auth/verify"),
    ),
  ).toBe(false);
  expect(requests.at(-1)).toContain("/auth/logout");
  await withSession(
    { apiBaseUrl, recoveryKey: seedPhrase },
    async ({ sdk }) => {
      expect(await sdk.session.listSessions()).toHaveLength(1);
    },
  );
});

test("revokes the issued session when local identity pinning fails after verification", async () => {
  const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
  const db = await localDatabase.openLocalDatabase();
  let afterVerify = false;
  onRequest = (request) => {
    if (request.endsWith("/auth/verify")) afterVerify = true;
  };
  const exec = db.client.exec.bind(db.client);
  const dbOpen = spyOn(
    localDatabase,
    "openLocalDatabase",
  ).mockResolvedValueOnce({
    ...db,
    client: {
      exec: async (options) => {
        if (afterVerify) {
          afterVerify = false;
          throw new Error("Local pin storage failed");
        }
        return exec(options);
      },
    },
  });
  requests.length = 0;
  let failure: unknown;
  try {
    await withSession({ apiBaseUrl, recoveryKey: seedPhrase }, async () => {
      throw new Error("Unexpected signed-in work");
    }).catch((error: unknown) => {
      failure = error;
    });
  } finally {
    dbOpen.mockRestore();
  }
  expect(String(failure)).toContain("Local pin storage failed");
  expect(String(failure)).not.toContain("session may remain");
  expect(requests.filter((request) => request.includes("/auth/"))).toEqual([
    "POST /auth/challenge",
    "POST /auth/verify",
    "POST /auth/logout",
  ]);
  await withSession(
    { apiBaseUrl, recoveryKey: seedPhrase },
    async ({ sdk }) => {
      expect(await sdk.session.listSessions()).toHaveLength(1);
    },
  );
});

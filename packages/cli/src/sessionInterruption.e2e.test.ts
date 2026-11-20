import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { withSession } from "./session";

let apiBaseUrl = "";
let server: Bun.Server<undefined>;
let expireNextSessionList = false;
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
    fetch: (request) => {
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
      return failing?.test(`${request.method} ${pathname}`)
        ? new Response("unavailable", { status: 503 })
        : routeApp.fetch(request);
    },
  });
  apiBaseUrl = server.url.origin;
});

afterEach(() => {
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

for (const ending of ["interrupt", "work failure"])
  test(`a command ending in ${ending} during renewal revokes the newly issued session`, async () => {
    const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
    let stop: (() => Promise<boolean>) | undefined;
    let cleanup: Promise<boolean> | undefined;
    const dispatch = Promise.withResolvers<void>();
    const command = withSession(
      {
        recoveryKey: seedPhrase,
        apiBaseUrl,
        registerShutdown: (revoke) => {
          stop = revoke;
        },
      },
      async ({ sdk }) => {
        expireNextSessionList = true;
        onRequest = (request) => {
          if (request.includes("/auth/verify")) {
            dispatch.resolve();
            if (ending === "interrupt") cleanup = stop?.();
          }
        };
        const listing = sdk.session.listSessions();
        await dispatch.promise;
        if (ending === "work failure") {
          void listing.catch(() => {});
          throw new Error("work failed");
        }
        await listing;
        expect(await cleanup).toBe(true);
      },
    );
    if (ending === "work failure")
      await expect(command).rejects.toThrow("work failed");
    else await command;
    expect(requests.at(-1)).toContain("/auth/logout");
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

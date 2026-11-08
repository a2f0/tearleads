import { expect, test } from "bun:test";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import { shouldRetryAfterSessionExpired } from "./sessionRefresh";
import { SessionRenewalTracker } from "./sessionRenewal";

for (const installed of [false, true]) {
  for (const switchIdentity of [false, true]) {
    test(`concurrent expired requests join one verified renewal: installed=${installed}, switch=${switchIdentity}`, async () => {
      let token: string | null = "identity-a";
      const tracker = new SessionRenewalTracker(() => token);
      const setToken = (next: string) => {
        token = next;
        tracker.tokenChanged();
      };
      const release = Promise.withResolvers<void>();
      let renewals = 0;
      let pendingJoins = 0;
      let notifications = 0;
      const input = {
        authToken: "identity-a",
        body: undefined,
        code: SESSION_ERROR_CODES.refreshRequired,
        responseStatus: 401,
        getCurrentAuthToken: () => token,
        isKnownSessionRenewal: (from: string, to: string) =>
          tracker.isKnown(from, to),
        pendingSessionRenewal: (from: string) => {
          pendingJoins += 1;
          return tracker.pending(from);
        },
        options: {
          onSessionRenewed: () => {
            notifications += 1;
          },
        },
        reportError: () => undefined,
        refreshSession: () =>
          tracker.renew(async () => {
            renewals += 1;
            if (installed) setToken("identity-a-renewed");
            await release.promise;
            if (!installed && !switchIdentity) setToken("identity-a-renewed");
            // A same-identity handler refuses a switch before token installation.
            return installed || !switchIdentity;
          }),
      };
      const first = shouldRetryAfterSessionExpired(input);
      const second = shouldRetryAfterSessionExpired(input);
      expect(renewals).toBe(1);
      expect(pendingJoins).toBe(installed ? 1 : 0);
      if (switchIdentity) setToken("identity-b");
      release.resolve();
      expect(await Promise.all([first, second])).toEqual([
        !switchIdentity,
        !switchIdentity,
      ]);
      expect(notifications).toBe(switchIdentity ? 0 : 2);
      expect(tracker.currentToken("identity-a")).toBe(
        switchIdentity ? null : "identity-a-renewed",
      );
    });
  }
}

// A request whose deadline or caller aborts during a renewal must settle at
// once, not when the renewal does; the renewal is shared, so a request still
// waiting on it is renewed as usual.
test("an aborted request stops waiting for a shared renewal without cancelling it", async () => {
  let token: string | null = "identity-a";
  const tracker = new SessionRenewalTracker(() => token);
  const release = Promise.withResolvers<void>();
  let renewals = 0;
  const input = (signal?: AbortSignal) => ({
    authToken: "identity-a",
    body: undefined,
    code: SESSION_ERROR_CODES.refreshRequired,
    responseStatus: 401,
    getCurrentAuthToken: () => token,
    isKnownSessionRenewal: (from: string, to: string) =>
      tracker.isKnown(from, to),
    pendingSessionRenewal: (from: string) => tracker.pending(from),
    options: { signal },
    reportError: () => undefined,
    refreshSession: () =>
      tracker.renew(async () => {
        renewals += 1;
        await release.promise;
        token = "identity-a-renewed";
        tracker.tokenChanged();
        return true;
      }),
  });
  const controller = new AbortController();
  const abandoned = shouldRetryAfterSessionExpired(input(controller.signal));
  const waiting = shouldRetryAfterSessionExpired(input());
  controller.abort();

  expect(await abandoned).toBe(false);
  release.resolve();
  expect(await waiting).toBe(true);
  expect(renewals).toBe(1);
});

test("an already aborted request starts no renewal", async () => {
  const controller = new AbortController();
  controller.abort();
  let renewals = 0;
  await expect(
    shouldRetryAfterSessionExpired({
      authToken: "identity-a",
      body: undefined,
      code: SESSION_ERROR_CODES.refreshRequired,
      responseStatus: 401,
      getCurrentAuthToken: () => "identity-a",
      isKnownSessionRenewal: () => false,
      pendingSessionRenewal: () => null,
      options: { signal: controller.signal },
      reportError: () => undefined,
      refreshSession: () => {
        renewals += 1;
        return true;
      },
    }),
  ).resolves.toBe(false);
  expect(renewals).toBe(0);
});

// Starting a renewal can abort the request before the wait listens for it;
// that abort must still end the wait rather than hang on the renewal.
test("a renewal that aborts its request while starting still ends the wait", async () => {
  const controller = new AbortController();
  const pendingRenewal = Promise.withResolvers<boolean>();
  const wait = shouldRetryAfterSessionExpired({
    authToken: "identity-a",
    body: undefined,
    code: SESSION_ERROR_CODES.refreshRequired,
    responseStatus: 401,
    getCurrentAuthToken: () => "identity-a",
    isKnownSessionRenewal: () => false,
    pendingSessionRenewal: () => null,
    options: { signal: controller.signal },
    reportError: () => undefined,
    refreshSession: () => {
      controller.abort();
      return pendingRenewal.promise;
    },
  });
  // Bound the wait: a regression hangs on the never-settled renewal.
  const hang = Promise.withResolvers<"hung">();
  const guard = setTimeout(() => hang.resolve("hung"), 2_000);
  try {
    expect(await Promise.race([wait, hang.promise])).toBe(false);
  } finally {
    clearTimeout(guard);
  }
  pendingRenewal.reject(new Error("renewal failed after the request ended"));
});

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

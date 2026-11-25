import { expect, test } from "bun:test";
import type { RequestResult } from "@tearleads/api-client";
import type { SessionContext, SessionSnapshot } from "../session/sessionTypes";
import { createTwoFactor, type TwoFactorStatus } from "./index";

const UNVERIFIED: TwoFactorStatus = {
  enabled: false,
  recoveryCodesRemaining: 0,
  requiredByOrganizationIds: ["org-1"],
  sessionVerified: false,
};

function ok<T>(data: T): RequestResult<T> {
  return { data, ok: true } as RequestResult<T>;
}

function fakeSession(authToken: string) {
  const listeners = new Set<() => void>();
  const contexts: SessionContext[] = [];
  const session = {
    contexts,
    setContext(context: SessionContext) {
      contexts.push(context);
    },
    snapshot: { authToken } as SessionSnapshot,
    signIn(token: string) {
      session.snapshot = { authToken: token } as SessionSnapshot;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return session;
}

function fakeApi(status: () => Promise<RequestResult<TwoFactorStatus>>) {
  return {
    beginTwoFactorSetupResult: async () =>
      ok({ otpauthUri: "otpauth://totp/x", secret: "SECRET" }),
    disableTwoFactorResult: async () =>
      ok({ ...UNVERIFIED, requiredByOrganizationIds: [] }),
    enableTwoFactorResult: async () =>
      ok({ deviceToken: "device-1", enabled: true, recoveryCodes: ["a", "b"] }),
    getTwoFactorStatusResult: status,
    regenerateTwoFactorRecoveryCodesResult: async () =>
      ok({ recoveryCodes: ["c"] }),
  } as unknown as Parameters<typeof createTwoFactor>[0];
}

test("status and changes publish the session's standing", async () => {
  const session = fakeSession("token-1");
  const twoFactor = createTwoFactor(
    fakeApi(async () => ok(UNVERIFIED)),
    session,
    { onSessionVerified: () => {} },
  );
  let notified = 0;
  twoFactor.subscribe(() => {
    notified += 1;
  });
  expect(twoFactor.snapshot).toBeNull();

  await twoFactor.status();
  expect(twoFactor.snapshot).toEqual(UNVERIFIED);

  expect(await twoFactor.enable("123456", { rememberDevice: true })).toEqual([
    "a",
    "b",
  ]);
  expect(twoFactor.snapshot).toEqual({
    enabled: true,
    recoveryCodesRemaining: 2,
    requiredByOrganizationIds: [],
    sessionVerified: true,
  });
  expect(session.contexts).toEqual([{ twoFactorDeviceToken: "device-1" }]);

  await twoFactor.regenerateRecoveryCodes({ code: "1", method: "totp" });
  expect(twoFactor.snapshot?.recoveryCodesRemaining).toBe(1);
  expect(notified).toBe(3);
});

test("a new session token forgets the standing", async () => {
  const session = fakeSession("token-1");
  const twoFactor = createTwoFactor(
    fakeApi(async () => ok(UNVERIFIED)),
    session,
    { onSessionVerified: () => {} },
  );
  await twoFactor.status();

  session.signIn("token-2");
  expect(twoFactor.snapshot).toBeNull();
});

test("an answer for an earlier session token is not published", async () => {
  const session = fakeSession("token-1");
  let answer: (result: RequestResult<TwoFactorStatus>) => void = () => {};
  const twoFactor = createTwoFactor(
    fakeApi(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    ),
    session,
    { onSessionVerified: () => {} },
  );

  const pending = twoFactor.status();
  session.signIn("token-2");
  answer(ok(UNVERIFIED));
  expect(await pending).toEqual(UNVERIFIED);
  expect(twoFactor.snapshot).toBeNull();
});

test("enabling reports the verified session, not one that replaced it", async () => {
  const session = fakeSession("token-1");
  let verified = 0;
  const api = fakeApi(async () => ok(UNVERIFIED));
  const twoFactor = createTwoFactor(api, session, {
    onSessionVerified: () => {
      verified += 1;
    },
  });

  await twoFactor.enable("123456");
  expect(verified).toBe(1);

  const enable = api.enableTwoFactorResult;
  api.enableTwoFactorResult = async (body) => {
    session.signIn("token-2");
    return enable(body);
  };
  await twoFactor.enable("123456");
  expect(verified).toBe(1);
});

import { expect, test } from "bun:test";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import type { UserStanding } from "../../middleware/userActivity";
import { openLoginSession } from "./loginSession";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function recordingRuntime(standing: UserStanding | undefined) {
  const runtime = createServiceTestRuntime();
  const opened: (readonly string[])[] = [];
  const revoked: string[] = [];
  runtime.sessionTokenIssuer = {
    createSession: async (input) => {
      opened.push(input.twoFactorRequiredOrganizationIds);
      const n = opened.length;
      return {
        sessionId: `session-${n}`,
        token: `token-${n}`,
        ...(standing ? { standing } : {}),
      };
    },
    revokeSession: async ({ sessionId }) => {
      revoked.push(sessionId);
      return true;
    },
  };
  return { opened, revoked, runtime };
}

function open(
  runtime: ReturnType<typeof createServiceTestRuntime>,
  twoFactorVerified: boolean,
) {
  return openLoginSession(runtime, {
    fingerprint: "f".repeat(64),
    twoFactorRequiredOrganizationIds: [],
    twoFactorVerified,
    userId: USER_ID,
  });
}

test("a requirement committed while signing in reissues the session with it", async () => {
  const { opened, revoked, runtime } = recordingRuntime({
    suspended: false,
    twoFactorEnabled: false,
    twoFactorRequiredOrganizationIds: [ORGANIZATION_ID],
  });

  expect(await open(runtime, false)).toEqual({
    sessionId: "session-2",
    status: "open",
    token: "token-2",
  });
  expect(opened).toEqual([[], [ORGANIZATION_ID]]);
  expect(revoked).toEqual(["session-1"]);
});

test("a session that passed a second factor ignores requirements", async () => {
  const { opened, revoked, runtime } = recordingRuntime({
    suspended: false,
    twoFactorEnabled: false,
    twoFactorRequiredOrganizationIds: [ORGANIZATION_ID],
  });

  expect((await open(runtime, true)).status).toBe("open");
  expect(opened).toEqual([[]]);
  expect(revoked).toEqual([]);
});

test("a suspension read after storing revokes the session", async () => {
  const { revoked, runtime } = recordingRuntime({
    suspended: true,
    twoFactorEnabled: false,
    twoFactorRequiredOrganizationIds: [ORGANIZATION_ID],
  });

  expect(await open(runtime, false)).toEqual({ status: "suspended" });
  expect(revoked).toEqual(["session-1"]);
});

test("two-factor turned on while signing in refuses a session without it", async () => {
  // The sign-in read the record before two-factor was on; turning it on swept
  // the user's sessions before this one was stored.
  const { revoked, runtime } = recordingRuntime({
    suspended: false,
    twoFactorEnabled: true,
    twoFactorRequiredOrganizationIds: [ORGANIZATION_ID],
  });

  expect(await open(runtime, false)).toEqual({
    status: "two_factor_required",
  });
  expect(revoked).toEqual(["session-1"]);
});

test("a session that passed a second factor stands once two-factor is on", async () => {
  const { revoked, runtime } = recordingRuntime({
    suspended: false,
    twoFactorEnabled: true,
    twoFactorRequiredOrganizationIds: [],
  });

  expect((await open(runtime, true)).status).toBe("open");
  expect(revoked).toEqual([]);
});

test("a failed activity stamp falls back to reading the standing", async () => {
  const { opened, revoked, runtime } = recordingRuntime(undefined);

  // An unknown user reads as not suspended and required nowhere.
  expect((await open(runtime, false)).status).toBe("open");
  expect(opened).toEqual([[]]);
  expect(revoked).toEqual([]);
});

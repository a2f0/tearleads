import { expect, test } from "bun:test";
import { runConfirmedLogout } from "./useLogoutConfirmation";

test("a delayed logout cannot clear or wipe a newly selected identity", async () => {
  let currentSigningFingerprint: string | null = "identity-a";
  let localLogoutCount = 0;
  let purgeCount = 0;
  let clearedSessionListCount = 0;

  const result = await runConfirmedLogout({
    getSigningFingerprint: () => currentSigningFingerprint,
    keepLocalData: false,
    log: () => undefined,
    logError: () => undefined,
    logout: () => {
      localLogoutCount += 1;
    },
    onAfterLocalLogout: () => {
      clearedSessionListCount += 1;
    },
    purgeWorker: async () => {
      purgeCount += 1;
    },
    session: {
      logoutRemote: async () => {
        currentSigningFingerprint = "identity-b";
        return true;
      },
    },
    signingFingerprint: "identity-a",
  });

  expect(result).toBe(true);
  expect(localLogoutCount).toBe(0);
  expect(clearedSessionListCount).toBe(0);
  expect(purgeCount).toBe(0);
});

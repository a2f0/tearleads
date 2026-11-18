import { expect, test } from "bun:test";
import { runConfirmedLogout } from "./useLogoutConfirmation";

test("a delayed logout cannot clear or wipe a newly selected identity", async () => {
  let currentSigningFingerprint: string | null = "identity-a";
  let purgeCount = 0;
  let clearedSessionListCount = 0;

  const result = await runConfirmedLogout({
    getSigningFingerprint: () => currentSigningFingerprint,
    keepLocalData: false,
    log: () => undefined,
    logError: () => undefined,
    onAfterLocalLogout: () => {
      clearedSessionListCount += 1;
    },
    purgeWorker: async () => {
      purgeCount += 1;
    },
    session: {
      logoutRemote: async (onLocalLogout) => {
        currentSigningFingerprint = "identity-b";
        await onLocalLogout?.(() => true);
        return true;
      },
    },
    signingFingerprint: "identity-a",
  });

  expect(result).toBe(true);
  expect(clearedSessionListCount).toBe(0);
  expect(purgeCount).toBe(0);
});

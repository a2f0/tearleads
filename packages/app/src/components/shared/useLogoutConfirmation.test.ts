import { expect, test } from "bun:test";
import { createDomainScope } from "@tearleads/client-sdk";
import { act, renderHook } from "@testing-library/react";
import {
  runConfirmedLogout,
  useLogoutConfirmationDialogState,
} from "./useLogoutConfirmation";

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

test("a completed logout closes only the dialog that submitted it", () => {
  let scope = createDomainScope();
  const { result, rerender, unmount } = renderHook(() =>
    useLogoutConfirmationDialogState(scope),
  );
  try {
    act(result.current.requestLogout);
    const closeFirst = result.current.closeLogoutDialog;
    scope = createDomainScope();
    rerender();
    act(result.current.requestLogout);
    act(closeFirst);
    expect(result.current.isOpen).toBe(true);
  } finally {
    unmount();
  }
});

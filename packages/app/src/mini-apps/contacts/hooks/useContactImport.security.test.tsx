import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useImportContactByUserId } from "./useContactImport";

afterEach(cleanup);

test("a roster message cannot import an unpinned contact by user ID", async () => {
  const input = {
    identityScope: "alice",
    importKey: mock(async () => "contact-bob"),
    resolvePinned: mock(async () => null),
    onUnpinnedIdentity: mock(() => {}),
    isImportReady: true,
    isSubmittingRef: { current: false },
    logError: mock(() => {}),
    setIsSubmitting: mock(() => {}),
    setSelectedContactId: mock(() => {}),
  };
  const view = renderHook(() => useImportContactByUserId(input));
  await act(async () => {
    await view.result.current("bob");
  });
  expect(input.importKey).not.toHaveBeenCalled();
  expect(input.onUnpinnedIdentity).toHaveBeenCalled();
});

import { afterEach, expect, mock, test } from "bun:test";
import type { ResolvedUserIdentity } from "@tearleads/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useImportContactByUserId } from "./useContactImport";

afterEach(cleanup);

const identity: ResolvedUserIdentity = {
  userId: "bob",
  signingPublicKey: "s",
  signingKeyFingerprint: "sf",
  encapsulationPublicKey: "e",
  encapsulationKeyFingerprint: "ef",
};

function inputs() {
  return {
    identityScope: "alice",
    importKey: mock(async (_userId: string) => "contact-bob"),
    resolvePinned: mock(
      async (_userId: string): Promise<ResolvedUserIdentity | null> => null,
    ),
    onUnpinnedIdentity: mock(() => {}),
    isImportReady: true,
    isSubmittingRef: { current: false },
    logError: mock(() => {}),
    setIsSubmitting: mock(() => {}),
    setSelectedContactId: mock((_id: string) => {}),
  };
}

test("a roster message cannot import an unpinned contact by user ID", async () => {
  const input = inputs();
  const view = renderHook(() => useImportContactByUserId(input));
  await act(async () => {
    await view.result.current("bob");
  });
  expect(input.importKey).not.toHaveBeenCalled();
  expect(input.onUnpinnedIdentity).toHaveBeenCalled();
});

test("a roster message reuses a pinned contact", async () => {
  const input = inputs();
  input.resolvePinned.mockImplementation(async () => identity);
  const view = renderHook(() => useImportContactByUserId(input));
  await act(async () => {
    await view.result.current("bob");
  });
  expect(input.importKey).toHaveBeenCalledWith("bob");
  expect(input.setSelectedContactId).toHaveBeenCalledWith("contact-bob");
  expect(input.onUnpinnedIdentity).not.toHaveBeenCalled();
});

test("a pending pin lookup cannot import after the active identity switches", async () => {
  const input = inputs();
  const gate = Promise.withResolvers<ResolvedUserIdentity | null>();
  input.resolvePinned.mockImplementation(() => gate.promise);
  const view = renderHook((props) => useImportContactByUserId(props), {
    initialProps: input,
  });
  let pending: Promise<string | null> | undefined;
  act(() => {
    pending = view.result.current("bob");
  });
  view.rerender({ ...input, identityScope: "charlie" });
  await act(async () => {
    gate.resolve(identity);
    await pending;
  });
  expect(input.importKey).not.toHaveBeenCalled();
  expect(input.onUnpinnedIdentity).not.toHaveBeenCalled();
});

import { afterEach, expect, mock, test } from "bun:test";
import type { ResolvedUserIdentity } from "@tearleads/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useImportContactIdentityLink } from "./useImportContactIdentityLink";

afterEach(cleanup);

const identity: ResolvedUserIdentity = {
  userId: "bob",
  signingPublicKey: "signing-key",
  signingKeyFingerprint: "signing-fingerprint",
  encapsulationPublicKey: "encryption-key",
  encapsulationKeyFingerprint: "encryption-fingerprint",
};

function inputs() {
  return {
    draft: "https://app.example.test/app/contacts/import/bob-link",
    identityScope: "alice",
    importKey: mock(async (_userId: string) => "bob-contact"),
    isImportReady: true,
    isSubmittingRef: { current: false },
    setIsSubmitting: mock((_busy: boolean) => {}),
    setDraft: mock((_draft: string) => {}),
    onImported: mock((_contactId: string) => {}),
    verifyLink: mock(async (_link: string) => identity),
  };
}

test("contact onboarding verifies before writing and reports a mismatch without importing", async () => {
  const input = inputs();
  input.verifyLink.mockImplementation(async () => {
    throw new Error("Keys do not match the link.");
  });
  const { result } = renderHook(() => useImportContactIdentityLink(input));
  await act(() => result.current.importContact());
  expect(result.current.error).toBe("Keys do not match the link.");
  expect(input.importKey).not.toHaveBeenCalled();
  expect(input.onImported).not.toHaveBeenCalled();
  input.verifyLink.mockImplementation(async () => {
    expect(input.importKey).not.toHaveBeenCalled();
    return identity;
  });
  await act(() => result.current.importContact());
  expect(input.importKey).toHaveBeenCalledWith("bob");
  expect(input.onImported).toHaveBeenCalledWith("bob-contact");
  expect(result.current.error).toBeNull();
});

test("a contact link waits for sign-in and permits only one concurrent verification", async () => {
  const input = inputs();
  const gate = Promise.withResolvers<ResolvedUserIdentity>();
  input.verifyLink.mockImplementation(() => gate.promise);
  const { result, rerender } = renderHook(
    (props) => useImportContactIdentityLink(props),
    { initialProps: { ...input, isImportReady: false } },
  );
  await act(() => result.current.importContact());
  expect(input.verifyLink).not.toHaveBeenCalled();
  rerender(input);
  let pending: Promise<void> | undefined;
  act(() => {
    pending = result.current.importContact();
  });
  await act(() => result.current.importContact());
  expect(input.verifyLink).toHaveBeenCalledTimes(1);
  expect(input.importKey).not.toHaveBeenCalled();
  await act(async () => {
    gate.resolve(identity);
    await pending;
  });
  expect(input.importKey).toHaveBeenCalledTimes(1);
});

test("identity switches and unmounts during verification prevent contact writes", async () => {
  for (const mode of ["switch", "unmount"] as const) {
    const input = inputs();
    const gate = Promise.withResolvers<ResolvedUserIdentity>();
    input.verifyLink.mockImplementation(() => gate.promise);
    const view = renderHook((props) => useImportContactIdentityLink(props), {
      initialProps: input,
    });
    let pending: Promise<void> | undefined;
    act(() => {
      pending = view.result.current.importContact();
    });
    if (mode === "switch")
      view.rerender({ ...input, identityScope: "charlie" });
    else view.unmount();
    await act(async () => {
      gate.resolve(identity);
      await pending;
    });
    expect(input.importKey).not.toHaveBeenCalled();
    expect(input.onImported).not.toHaveBeenCalled();
    view.unmount();
  }
});

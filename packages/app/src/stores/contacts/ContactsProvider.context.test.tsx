import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { ContactsContext, useContacts } from "./ContactsProvider";
import type { ContactsStore } from "./contactStore";

afterEach(() => cleanup());

test("contacts context projects only its public store and snapshot surface", () => {
  const updateContact = mock(async () => undefined);
  const unused = mock(async () => undefined);
  const snapshot = { entries: [], ready: true };
  const store = {
    createContact: unused,
    ensureSelfContact: unused,
    getSnapshot: () => snapshot,
    importKey: unused,
    removeContact: unused,
    removeContactAvatar: unused,
    setContactAvatar: unused,
    subscribe: () => () => undefined,
    updateContact,
    updateRuntime: unused,
  } as unknown as ContactsStore;
  function ContactsTestProvider({ children }: PropsWithChildren) {
    return (
      <ContactsContext.Provider value={{ canWrite: true, store }}>
        {children}
      </ContactsContext.Provider>
    );
  }
  const view = renderHook(() => useContacts(), {
    wrapper: ContactsTestProvider,
  });

  expect(Object.keys(view.result.current).sort()).toEqual(
    [
      "canWrite",
      "createContact",
      "entries",
      "importKey",
      "ready",
      "removeContact",
      "removeContactAvatar",
      "setContactAvatar",
      "updateContact",
    ].sort(),
  );
  expect(view.result.current.updateContact).toBe(updateContact);
  expect("ensureSelfContact" in view.result.current).toBe(false);
  expect("updateRuntime" in view.result.current).toBe(false);
});

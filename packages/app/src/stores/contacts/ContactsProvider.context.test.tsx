import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { ContactsContext, useContacts } from "./ContactsProvider";
import type { ContactsStore } from "./contactStore";

afterEach(() => cleanup());

test("contacts context projects only its public store and snapshot surface", () => {
  const updateContact = mock(async () => undefined);
  const addContactAddress = mock(async () => "address");
  const unused = mock(async () => undefined);
  const snapshot = { entries: [], ready: true };
  const store = {
    addContactAddress,
    removeContactAddress: unused,
    updateContactAddress: unused,
    createContact: unused,
    ensureSelfContact: unused,
    getSnapshot: () => snapshot,
    importVerifiedUser: unused,
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
      "addContactAddress",
      "removeContactAddress",
      "updateContactAddress",
      "canWrite",
      "createContact",
      "entries",
      "importVerifiedUser",
      "ready",
      "removeContact",
      "removeContactAvatar",
      "setContactAvatar",
      "updateContact",
    ].sort(),
  );
  expect(view.result.current.updateContact).toBe(updateContact);
  expect(view.result.current.addContactAddress).toBe(addContactAddress);
  expect(view.result.current.updateContactAddress).toBe(unused);
  expect(view.result.current.removeContactAddress).toBe(unused);
  expect("ensureSelfContact" in view.result.current).toBe(false);
  expect("updateRuntime" in view.result.current).toBe(false);
});

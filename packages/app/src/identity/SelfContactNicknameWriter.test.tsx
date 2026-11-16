import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ContactEntry } from "../document-types/contact/contactDocumentModel";
import { LogProvider } from "../providers/logging/LogProvider";
import { ContactsContext } from "../stores/contacts/ContactsProvider";
import type { ContactsStore } from "../stores/contacts/contactStore";
import { getSelfContactLocalId } from "../stores/contacts/selfContact";
import { SelfContactNicknameWriter } from "./SelfContactNicknameWriter";

afterEach(cleanup);

const FINGERPRINT = "fp-self";
const SELF_ID = getSelfContactLocalId(FINGERPRINT);

function selfEntry(nickname: string | null): ContactEntry {
  return {
    encapsulationPublicKey: null,
    firstName: "",
    id: SELF_ID,
    isSelf: true,
    lastName: "",
    nickname,
    userId: "user-self",
  };
}

/**
 * A contacts store whose `updateContact` puts the edit in memory, as the real
 * store does whether or not the save lands, and resolves with `saves.shift()`.
 */
function renderWriter(nickname: string | null, saves: boolean[]) {
  let snapshot = { entries: [selfEntry(nickname)], ready: true };
  const listeners = new Set<() => void>();
  const updateContact = mock(
    async (id: string, patch: Partial<ContactEntry>) => {
      snapshot = {
        ...snapshot,
        entries: snapshot.entries.map((entry) =>
          entry.id === id ? { ...entry, ...patch } : entry,
        ),
      };
      for (const listener of listeners) listener();
      return saves.shift() ?? false;
    },
  );
  const store = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateContact,
  } as unknown as ContactsStore;
  const onNamed = mock((_fingerprint: string) => {});
  const touchContact = () => {
    snapshot = {
      ...snapshot,
      entries: snapshot.entries.map((e) => ({ ...e })),
    };
    for (const listener of listeners) listener();
  };
  render(
    <LogProvider>
      <ContactsContext.Provider value={{ canWrite: true, store }}>
        <SelfContactNicknameWriter
          fingerprint={FINGERPRINT}
          name="Bob"
          onNamed={onNamed}
        />
      </ContactsContext.Provider>
    </LogProvider>,
  );
  return { onNamed, touchContact, updateContact };
}

test("a nickname whose save failed is not taken as named, and is retried", async () => {
  const { onNamed, touchContact, updateContact } = renderWriter(null, [
    false,
    true,
  ]);
  await waitFor(() => expect(updateContact).toHaveBeenCalledTimes(1));
  expect(updateContact.mock.calls[0]).toEqual([SELF_ID, { nickname: "Bob" }]);
  // The failed save left "Bob" showing in memory; that is no proof.
  await act(async () => {
    await updateContact.mock.results[0]?.value;
  });
  expect(onNamed).not.toHaveBeenCalled();

  touchContact();
  await waitFor(() => expect(onNamed).toHaveBeenCalledWith(FINGERPRINT));
  expect(updateContact).toHaveBeenCalledTimes(2);
});

test("a nickname the contact already has is kept", async () => {
  const { onNamed, updateContact } = renderWriter("Robert", []);
  await waitFor(() => expect(onNamed).toHaveBeenCalledWith(FINGERPRINT));
  expect(updateContact).not.toHaveBeenCalled();
});

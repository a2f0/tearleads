import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ContactEntry } from "../../../document-types/contact/contactDocumentModel";
import type { ContactsRoute } from "../routes";
import { ContactsDetailPanel } from "./ContactsDetailPanel";

afterEach(() => {
  cleanup();
});

const contactEntry: ContactEntry = {
  encapsulationPublicKey: "public-key",
  firstName: "Ada",
  id: "ada",
  isSelf: false,
  lastName: "Lovelace",
  nickname: "Countess",
  userId: "ada-user",
};

function createContactsDetailPanelProps(
  props: Partial<Parameters<typeof ContactsDetailPanel>[0]> & {
    route?: ContactsRoute | undefined;
  } = {},
): Parameters<typeof ContactsDetailPanel>[0] {
  return {
    canCreate: false,
    canImport: false,
    createDraftContact: async () => undefined,
    draftFirstName: "",
    draftLastName: "",
    draftNickname: "",
    draftUserId: "",
    entries: [],
    importDraftContact: async () => undefined,
    isAuthenticated: true,
    onBackToSelectionRoute: () => undefined,
    ready: true,
    route: "selection",
    selectedContactId: null,
    setDraftFirstName: () => undefined,
    setDraftLastName: () => undefined,
    setDraftNickname: () => undefined,
    setDraftUserId: () => undefined,
    updateContact: () => undefined,
    ...props,
  };
}

function renderContactsDetailPanel(
  props: Partial<Parameters<typeof ContactsDetailPanel>[0]> & {
    route?: ContactsRoute | undefined;
  } = {},
) {
  return render(
    <ContactsDetailPanel {...createContactsDetailPanelProps(props)} />,
  );
}

test("contacts selection route omits create and import controls", () => {
  const view = renderContactsDetailPanel();

  expect(view.getByText("No contacts imported yet.")).toBeTruthy();
  expect(view.queryByLabelText("Contact user ID")).toBeNull();
  expect(view.queryByRole("button", { name: "Create" })).toBeNull();
});

test("contacts new-contact route submits the contact draft", () => {
  let createCount = 0;
  const view = renderContactsDetailPanel({
    canCreate: true,
    createDraftContact: async () => {
      createCount += 1;
    },
    draftNickname: "Ada",
    route: "new-contact",
  });

  expect(view.getByText("New Contact")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Create" }));

  expect(createCount).toBe(1);
});

test("contacts selected detail fields update when contact entries change", () => {
  const view = renderContactsDetailPanel({
    entries: [contactEntry],
    selectedContactId: contactEntry.id,
  });

  expect((view.getByLabelText("Nickname") as HTMLInputElement).value).toBe(
    "Countess",
  );

  view.rerender(
    <ContactsDetailPanel
      {...createContactsDetailPanelProps({
        entries: [{ ...contactEntry, nickname: "Ada" }],
        selectedContactId: contactEntry.id,
      })}
    />,
  );

  expect((view.getByLabelText("Nickname") as HTMLInputElement).value).toBe(
    "Ada",
  );
});

test("contacts new-contact back action does not submit the draft form", () => {
  let backCount = 0;
  let createCount = 0;
  const view = renderContactsDetailPanel({
    canCreate: true,
    createDraftContact: async () => {
      createCount += 1;
    },
    draftNickname: "Ada",
    onBackToSelectionRoute: () => {
      backCount += 1;
    },
    route: "new-contact",
  });

  fireEvent.click(view.getByRole("button", { name: "Back to Contacts" }));

  expect(backCount).toBe(1);
  expect(createCount).toBe(0);
});

test("contacts import-contact route keeps import auth feedback scoped to import", () => {
  const view = renderContactsDetailPanel({
    isAuthenticated: false,
    route: "import-contact",
  });

  expect(view.getByText("Import Contact")).toBeTruthy();
  expect(
    view.getByText("Authenticate before importing peer keys."),
  ).toBeTruthy();
  expect(
    (view.getByRole("button", { name: "Import" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

test("contacts import-contact back action does not submit the import form", () => {
  let backCount = 0;
  let importCount = 0;
  const view = renderContactsDetailPanel({
    canImport: true,
    draftUserId: "peer-user-1",
    importDraftContact: async () => {
      importCount += 1;
    },
    onBackToSelectionRoute: () => {
      backCount += 1;
    },
    route: "import-contact",
  });

  fireEvent.click(view.getByRole("button", { name: "Back to Contacts" }));

  expect(backCount).toBe(1);
  expect(importCount).toBe(0);
});

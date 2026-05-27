import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ContactsRoute } from "../routes";
import { ContactsDetailPanel } from "./ContactsDetailPanel";

afterEach(() => {
  cleanup();
});

function renderContactsDetailPanel(
  props: Partial<Parameters<typeof ContactsDetailPanel>[0]> & {
    route?: ContactsRoute | undefined;
  } = {},
) {
  return render(
    <ContactsDetailPanel
      canCreate={false}
      canImport={false}
      createDraftContact={async () => undefined}
      draftFirstName=""
      draftLastName=""
      draftNickname=""
      draftUserId=""
      entries={[]}
      importDraftContact={async () => undefined}
      isAuthenticated
      onBackToSelectionRoute={() => undefined}
      ready
      route="selection"
      selectedContactId={null}
      setDraftFirstName={() => undefined}
      setDraftLastName={() => undefined}
      setDraftNickname={() => undefined}
      setDraftUserId={() => undefined}
      updateContact={() => undefined}
      {...props}
    />,
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

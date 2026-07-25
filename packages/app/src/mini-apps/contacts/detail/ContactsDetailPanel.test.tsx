import { afterEach, expect, test } from "bun:test";
import type { BlobStore } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  useWindowBackActionValue,
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "../../../components/window/WindowMenuContext";
import type { ContactEntry } from "../../../document-types/contact/contactDocumentModel";
import { createAppHostConfig } from "../../../host/AppHostConfig";
import { AppHostConfigProvider } from "../../../providers/host/AppHostConfigProvider";
import { CONTACTS_LABELS } from "../labels";
import type { ContactsRoute } from "../routes";
import type { ContactEntryPatch } from "../types";
import { ContactsDetailPanel } from "./ContactsDetailPanel";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

const emptyBlobStore: BlobStore = {
  deleteBytes: async () => undefined,
  openByteSource: async () => null,
  readBytes: async () => null,
  writeByteSource: async () => undefined,
  writeBytes: async () => undefined,
};

const hostConfig = createAppHostConfig({
  apiBaseUrl: "http://api.example.test",
  wsUrl: "ws://api.example.test/events",
});

afterEach(() => {
  cleanup();
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  } else {
    delete (navigator as { clipboard?: Clipboard }).clipboard;
  }
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
    blobStore: emptyBlobStore,
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
    onAreaContextMenu: () => undefined,
    onBackToSelectionRoute: () => undefined,
    ready: true,
    removeContactAvatar: () => undefined,
    route: "selection",
    selectedContactId: null,
    setContactAvatar: () => undefined,
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
    <AppHostConfigProvider value={hostConfig}>
      <WindowMenuProvider>
        <RoutedChromeProbe />
        <ContactsDetailPanel {...createContactsDetailPanelProps(props)} />
      </WindowMenuProvider>
    </AppHostConfigProvider>,
  );
}

function RoutedChromeProbe() {
  const backAction = useWindowBackActionValue();
  const actions = useWindowTitleBarActions();

  return (
    <>
      {backAction ? (
        <button
          aria-label={backAction.label}
          disabled={backAction.disabled}
          type="button"
          onClick={backAction.onClick}
        />
      ) : null}
      <div aria-label="Toolbar" role="toolbar">
        {actions.map((action) => (
          <button
            aria-label={action.label}
            disabled={action.disabled}
            key={action.id}
            type="button"
            onClick={action.onClick}
          />
        ))}
      </div>
    </>
  );
}

function installClipboardWriteMock(): string[] {
  const writes: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (value: string) => {
        writes.push(value);
        return Promise.resolve();
      },
    },
  });
  return writes;
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

  fireEvent.click(view.getByRole("button", { name: "Edit" }));

  expect((view.getByLabelText("Nickname") as HTMLInputElement).value).toBe(
    "Countess",
  );

  view.rerender(
    <AppHostConfigProvider value={hostConfig}>
      <WindowMenuProvider>
        <RoutedChromeProbe />
        <ContactsDetailPanel
          {...createContactsDetailPanelProps({
            entries: [{ ...contactEntry, nickname: "Ada" }],
            selectedContactId: contactEntry.id,
          })}
        />
      </WindowMenuProvider>
    </AppHostConfigProvider>,
  );

  expect((view.getByLabelText("Nickname") as HTMLInputElement).value).toBe(
    "Ada",
  );
});

test("contacts selected detail opens read-only before entering edit mode", () => {
  const view = renderContactsDetailPanel({
    entries: [contactEntry],
    selectedContactId: contactEntry.id,
  });

  expect(view.getByText("Countess")).toBeTruthy();
  expect(view.queryByLabelText("Nickname")).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Edit" }));

  expect((view.getByLabelText("Nickname") as HTMLInputElement).value).toBe(
    "Countess",
  );
  expect(view.getByRole("button", { name: "Done" })).toBeTruthy();
});

test("contacts selected detail edits from the toolbar", async () => {
  const view = renderContactsDetailPanel({
    entries: [contactEntry],
    selectedContactId: contactEntry.id,
  });

  await waitFor(() => {
    expect(
      view.getByRole("button", { name: CONTACTS_LABELS.editAction }),
    ).toBeTruthy();
  });
  expect(view.container.querySelector(".mini-app-actions")).toBeNull();

  fireEvent.click(
    view.getByRole("button", { name: CONTACTS_LABELS.editAction }),
  );

  expect((view.getByLabelText("Nickname") as HTMLInputElement).value).toBe(
    "Countess",
  );
  expect(
    view.getByRole("button", { name: CONTACTS_LABELS.doneAction }),
  ).toBeTruthy();
});

test("contacts new-contact route moves back and create to chrome", async () => {
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

  await waitFor(() => {
    expect(
      view.getByRole("button", { name: CONTACTS_LABELS.backToContactsAction }),
    ).toBeTruthy();
    expect(
      view.getByRole("button", { name: CONTACTS_LABELS.createContactAction }),
    ).toBeTruthy();
  });
  expect(view.container.querySelector(".mini-app-actions")).toBeNull();

  fireEvent.click(
    view.getByRole("button", { name: CONTACTS_LABELS.backToContactsAction }),
  );
  fireEvent.click(
    view.getByRole("button", { name: CONTACTS_LABELS.createContactAction }),
  );

  expect(backCount).toBe(1);
  expect(createCount).toBe(1);
});

test("contacts selected detail copies the user id", () => {
  const clipboardWrites = installClipboardWriteMock();
  const view = renderContactsDetailPanel({
    entries: [contactEntry],
    selectedContactId: contactEntry.id,
  });

  fireEvent.click(
    view.getByRole("button", { name: CONTACTS_LABELS.copyUserIdAction }),
  );

  expect(clipboardWrites).toEqual(["ada-user"]);
});

test("contacts user id copy button keeps the edit field focused", () => {
  const updates: ContactEntryPatch[] = [];
  const view = renderContactsDetailPanel({
    entries: [contactEntry],
    selectedContactId: contactEntry.id,
    updateContact: (_contactId, patch) => {
      updates.push(patch);
    },
  });

  fireEvent.click(
    view.getByRole("button", { name: CONTACTS_LABELS.editAction }),
  );
  const userIdInput = view.getByLabelText(
    CONTACTS_LABELS.userIdField,
  ) as HTMLInputElement;

  userIdInput.focus();
  const defaultAllowed = fireEvent.mouseDown(
    view.getByRole("button", { name: CONTACTS_LABELS.copyUserIdAction }),
  );

  expect(defaultAllowed).toBe(false);
  expect(document.activeElement).toBe(userIdInput);
  expect(updates).toEqual([]);
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

test("contacts detail opens the area context menu from selection whitespace", () => {
  let areaContextMenuCount = 0;
  const view = renderContactsDetailPanel({
    onAreaContextMenu: (event) => {
      event.preventDefault();
      areaContextMenuCount += 1;
    },
  });

  const defaultAllowed = fireEvent.contextMenu(
    view.getByText("No contacts imported yet."),
  );

  expect(defaultAllowed).toBe(false);
  expect(areaContextMenuCount).toBe(1);
});

test("contacts detail opens the area context menu from selected panel whitespace", () => {
  let areaContextMenuCount = 0;
  const view = renderContactsDetailPanel({
    entries: [contactEntry],
    onAreaContextMenu: () => {
      areaContextMenuCount += 1;
    },
    selectedContactId: contactEntry.id,
  });
  const panel = view.container.querySelector(".mini-app-panel");
  if (!panel) {
    throw new Error("Expected selected contacts panel.");
  }

  fireEvent.contextMenu(panel);

  expect(areaContextMenuCount).toBe(1);
});

test("contacts detail does not open the area context menu from contact rows", () => {
  let areaContextMenuCount = 0;
  const view = renderContactsDetailPanel({
    entries: [contactEntry],
    onAreaContextMenu: () => {
      areaContextMenuCount += 1;
    },
    selectedContactId: contactEntry.id,
  });

  fireEvent.contextMenu(view.getByText("Countess"));

  expect(areaContextMenuCount).toBe(0);
});

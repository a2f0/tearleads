import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useState } from "react";
import type { ContactEntry } from "../../../document-types/contact/contactDocumentModel";
import { CONTACTS_LABELS } from "../labels";
import {
  ContactsContextMenuLayer,
  type ContactsContextMenuState,
  useContactsContextMenu,
} from "./ContactsContextMenu";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

afterEach(() => {
  cleanup();
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  } else {
    delete (navigator as { clipboard?: Clipboard }).clipboard;
  }
});

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

function ContactsContextMenuLayerHarness(params: {
  canRemoveContextMenuContact?: boolean | undefined;
  contextMenuContactUserId?: string | null | undefined;
  contextMenu: ContactsContextMenuState;
  openImportContactRoute?: (() => void) | undefined;
  openNewContactRoute?: (() => void) | undefined;
  ready?: boolean | undefined;
  removeContextMenuContact?: (() => Promise<void>) | undefined;
}) {
  const [contextMenu, setContextMenu] =
    useState<ContactsContextMenuState | null>(params.contextMenu);

  return (
    <ContactsContextMenuLayer
      canRemoveContextMenuContact={params.canRemoveContextMenuContact ?? true}
      canWrite={true}
      closeContextMenu={() => setContextMenu(null)}
      contextMenuContactUserId={params.contextMenuContactUserId ?? null}
      contextMenu={contextMenu}
      openImportContactRoute={
        params.openImportContactRoute ?? (() => undefined)
      }
      openNewContactRoute={params.openNewContactRoute ?? (() => undefined)}
      ready={params.ready ?? true}
      removeContextMenuContact={
        params.removeContextMenuContact ?? (async () => undefined)
      }
    />
  );
}

function ContactsContextMenuModelHarness(params: { entries: ContactEntry[] }) {
  const model = useContactsContextMenu({
    canWrite: true,
    entries: params.entries,
    removeContact: async () => undefined,
    selectedContactId: null,
    setSelectedContactId: () => undefined,
  });

  return (
    <>
      <button
        type="button"
        onContextMenu={(event: ReactMouseEvent<HTMLElement>) =>
          model.handleSidebarContextMenu(event, "ada")
        }
      >
        Ada contact
      </button>
      <button
        type="button"
        onContextMenu={(event: ReactMouseEvent<HTMLElement>) =>
          model.handleSidebarContextMenu(event, "missing")
        }
      >
        Missing contact
      </button>
      <output aria-label="Can remove contact">
        {model.canRemoveContextMenuContact ? "yes" : "no"}
      </output>
      <output aria-label="Context menu user ID">
        {model.contextMenuContactUserId ?? "none"}
      </output>
    </>
  );
}

test("contacts area context menu opens new contacts", () => {
  let openNewContactCount = 0;
  const view = render(
    <ContactsContextMenuLayerHarness
      contextMenu={{ id: { kind: "area" }, position: { x: 12, y: 34 } }}
      openNewContactRoute={() => {
        openNewContactCount += 1;
      }}
    />,
  );

  fireEvent.click(
    view.getByRole("button", { name: CONTACTS_LABELS.newContactAction }),
  );

  expect(openNewContactCount).toBe(1);
  expect(
    view.queryByRole("button", { name: CONTACTS_LABELS.newContactAction }),
  ).toBeNull();
});

test("contacts area context menu opens contact import", () => {
  let openImportContactCount = 0;
  const view = render(
    <ContactsContextMenuLayerHarness
      contextMenu={{ id: { kind: "area" }, position: { x: 12, y: 34 } }}
      openImportContactRoute={() => {
        openImportContactCount += 1;
      }}
    />,
  );

  fireEvent.click(
    view.getByRole("button", { name: CONTACTS_LABELS.importContactAction }),
  );

  expect(openImportContactCount).toBe(1);
  expect(
    view.queryByRole("button", { name: CONTACTS_LABELS.importContactAction }),
  ).toBeNull();
});

test("contacts row context menu removes contacts", () => {
  let removeContactCount = 0;
  const view = render(
    <ContactsContextMenuLayerHarness
      contextMenu={{
        id: { contactId: "ada", kind: "contact" },
        position: { x: 12, y: 34 },
      }}
      removeContextMenuContact={async () => {
        removeContactCount += 1;
      }}
    />,
  );

  fireEvent.click(
    view.getByRole("button", { name: CONTACTS_LABELS.removeContactAction }),
  );

  expect(removeContactCount).toBe(1);
});

test("contacts row context menu copies contact user ids", () => {
  const clipboardWrites = installClipboardWriteMock();
  const view = render(
    <ContactsContextMenuLayerHarness
      contextMenu={{
        id: { contactId: "ada", kind: "contact" },
        position: { x: 12, y: 34 },
      }}
      contextMenuContactUserId="ada-user"
    />,
  );

  fireEvent.click(
    view.getByRole("button", { name: CONTACTS_LABELS.copyUserIdAction }),
  );

  expect(clipboardWrites).toEqual(["ada-user"]);
  expect(
    view.queryByRole("button", { name: CONTACTS_LABELS.copyUserIdAction }),
  ).toBeNull();
});

test("contacts row context menu hides copy without a contact user id", () => {
  const view = render(
    <ContactsContextMenuLayerHarness
      contextMenu={{
        id: { contactId: "ada", kind: "contact" },
        position: { x: 12, y: 34 },
      }}
      contextMenuContactUserId={null}
    />,
  );

  expect(
    view.queryByRole("button", { name: CONTACTS_LABELS.copyUserIdAction }),
  ).toBeNull();
});

test("contacts row context menu hides copy without clipboard access", () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });

  const view = render(
    <ContactsContextMenuLayerHarness
      contextMenu={{
        id: { contactId: "ada", kind: "contact" },
        position: { x: 12, y: 34 },
      }}
      contextMenuContactUserId="ada-user"
    />,
  );

  expect(
    view.queryByRole("button", { name: CONTACTS_LABELS.copyUserIdAction }),
  ).toBeNull();
});

test("contacts row context menu disables remove without a contact entry", () => {
  const view = render(
    <ContactsContextMenuLayerHarness
      canRemoveContextMenuContact={false}
      contextMenu={{
        id: { contactId: "missing", kind: "contact" },
        position: { x: 12, y: 34 },
      }}
    />,
  );

  expect(
    (
      view.getByRole("button", {
        name: CONTACTS_LABELS.removeContactAction,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

test("contacts context menu model disables remove for stale contact ids", async () => {
  const view = render(<ContactsContextMenuModelHarness entries={[]} />);

  fireEvent.contextMenu(view.getByRole("button", { name: "Missing contact" }));

  await waitFor(() => {
    expect(view.getByLabelText("Can remove contact").textContent).toBe("no");
  });
});

test("contacts context menu model exposes contact user ids", async () => {
  const view = render(
    <ContactsContextMenuModelHarness
      entries={[
        {
          encapsulationPublicKey: null,
          firstName: "Ada",
          id: "ada",
          isSelf: false,
          lastName: "Lovelace",
          nickname: null,
          userId: "ada-user",
        },
      ]}
    />,
  );

  fireEvent.contextMenu(view.getByRole("button", { name: "Ada contact" }));

  await waitFor(() => {
    expect(view.getByLabelText("Context menu user ID").textContent).toBe(
      "ada-user",
    );
  });
});

import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { CONTACTS_LABELS } from "../labels";
import {
  ContactsContextMenuLayer,
  type ContactsContextMenuState,
} from "./ContactsContextMenu";

afterEach(() => cleanup());

function ContactsContextMenuLayerHarness(params: {
  canRemoveContextMenuContact?: boolean | undefined;
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
      closeContextMenu={() => setContextMenu(null)}
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

  fireEvent.click(view.getByRole("button", { name: "Remove" }));

  expect(removeContactCount).toBe(1);
});

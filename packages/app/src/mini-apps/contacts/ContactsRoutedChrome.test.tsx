import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "../../components/window/WindowMenuContext";
import { useContactsRoutedChromeActions } from "./ContactsRoutedChrome";
import { CONTACTS_LABELS } from "./labels";

afterEach(() => cleanup());

function ToolbarProbe() {
  const actions = useWindowTitleBarActions();

  return (
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
  );
}

function ContactsRoutedChromeHarness({
  onImport = () => undefined,
  onNewContact = () => undefined,
}: {
  onImport?: () => void;
  onNewContact?: () => void;
}) {
  useContactsRoutedChromeActions({
    canWrite: true,
    isRoutedShell: true,
    openImportContactRoute: onImport,
    openNewContactRoute: onNewContact,
    ready: true,
    route: "selection",
  });

  return <ToolbarProbe />;
}

test("contacts selection route exposes new and import toolbar actions", async () => {
  const invoked: string[] = [];
  const view = render(
    <WindowMenuProvider>
      <ContactsRoutedChromeHarness
        onImport={() => invoked.push("import")}
        onNewContact={() => invoked.push("new")}
      />
    </WindowMenuProvider>,
  );

  await waitFor(() => {
    expect(
      view.getByRole("button", { name: CONTACTS_LABELS.newContactAction }),
    ).toBeTruthy();
    expect(
      view.getByRole("button", { name: CONTACTS_LABELS.importContactAction }),
    ).toBeTruthy();
  });

  fireEvent.click(
    view.getByRole("button", { name: CONTACTS_LABELS.newContactAction }),
  );
  fireEvent.click(
    view.getByRole("button", { name: CONTACTS_LABELS.importContactAction }),
  );

  expect(invoked).toEqual(["new", "import"]);
});

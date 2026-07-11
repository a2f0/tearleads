import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "../../components/window/WindowMenuContext";
import { WindowToolBar } from "../../components/window/WindowToolBar";
import { useContactsRoutedChromeActions } from "./ContactsRoutedChrome";
import { CONTACTS_LABELS } from "./labels";
import type { ContactsRoute } from "./routes";

afterEach(() => cleanup());

// Module-scoped so a harness re-render (a context update triggers one) does not
// hand the chrome hook fresh closures and loop the action re-registration.
const noop = () => undefined;

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

function ContactsToolbarHarness({ route }: { route: ContactsRoute }) {
  useContactsRoutedChromeActions({
    canWrite: true,
    openImportContactRoute: noop,
    openNewContactRoute: noop,
    ready: true,
    route,
  });

  return <WindowToolBar />;
}

test("reserves the toolbar row on action-less routes so the bar height stays stable", async () => {
  const view = render(
    <WindowMenuProvider>
      <ContactsToolbarHarness route="new-contact" />
    </WindowMenuProvider>,
  );

  // The new-contact route registers no toolbar actions, but the reserved row
  // (WindowToolBar's role="toolbar") still mounts so its height matches the
  // selection route's filled bar.
  await view.findByRole("toolbar");
  expect(
    view.queryByRole("button", { name: CONTACTS_LABELS.newContactAction }),
  ).toBeNull();
});

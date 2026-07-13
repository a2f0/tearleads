import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { Window } from "../../../components/window/Window";
import {
  useWindowStateData,
  WindowStateProvider,
} from "../../../components/window/WindowStateProvider";
import { AppNavigationProvider } from "../../../navigation/AppNavigationProvider";
import { MiniAppBusProvider, useMiniAppBusActions } from "../../bus";
import type { MiniAppDefinition, MiniAppId } from "../../types";
import { useImportContactMessage } from "./useContactImport";

// Records each import call and hands back a promise the test resolves manually,
// so we can hold one import "in flight" while a second message arrives.
const importedUserIds: string[] = [];
const importResolvers: Array<(contactId: string | null) => void> = [];

function importContactByUserId(userId: string): Promise<string | null> {
  importedUserIds.push(userId);
  return new Promise((resolve) => {
    importResolvers.push(resolve);
  });
}

function EmptyMiniApp() {
  return null;
}

function ContactsProbe() {
  useImportContactMessage({ importContactByUserId, isImportReady: true });
  return <div>Contacts Ready</div>;
}

function createMiniApps(
  contactsComponent: ComponentType,
): Readonly<Record<MiniAppId, MiniAppDefinition>> {
  return {
    "backup-restore": { createComponent: () => EmptyMiniApp, title: "Backup" },
    contacts: { createComponent: () => contactsComponent, title: "Contacts" },
    explorer: { createComponent: () => EmptyMiniApp, title: "Explorer" },
    "identity-manager": { createComponent: () => EmptyMiniApp, title: "Ident" },
    notes: { createComponent: () => EmptyMiniApp, title: "Notes" },
    "org-manager": { createComponent: () => EmptyMiniApp, title: "Org" },
    "system-monitor": { createComponent: () => EmptyMiniApp, title: "Sys" },
  };
}

function ImportButtons() {
  const { openMiniApp } = useMiniAppBusActions();
  const importUser = (userId: string) =>
    openMiniApp({
      appId: "contacts",
      message: { appId: "contacts", type: "import-contact", userId },
      position: { x: 10, y: 10 },
    });
  return (
    <>
      {["user-1", "user-2", "user-3"].map((userId) => (
        <button key={userId} onClick={() => importUser(userId)} type="button">
          Import {userId}
        </button>
      ))}
    </>
  );
}

function WindowLayer() {
  const { windows } = useWindowStateData();
  return (
    <>
      {windows.map((entry) => (
        <Window key={entry.id} windowId={entry.id} />
      ))}
    </>
  );
}

afterEach(() => {
  cleanup();
  importedUserIds.length = 0;
  importResolvers.length = 0;
  window.history.replaceState(null, "", "/");
});

test("a message arriving mid-import is processed once the import completes", async () => {
  const view = render(
    <WindowStateProvider>
      <AppNavigationProvider
        mode="windowed"
        miniApps={createMiniApps(ContactsProbe)}
      >
        <MiniAppBusProvider>
          <ImportButtons />
          <WindowLayer />
        </MiniAppBusProvider>
      </AppNavigationProvider>
    </WindowStateProvider>,
  );

  // First import starts and is left in flight.
  fireEvent.click(view.getByRole("button", { name: "Import user-1" }));
  await waitFor(() => expect(importedUserIds).toEqual(["user-1"]));

  // Second message arrives while the first import is still pending. It must be
  // queued, not started, and not lost.
  fireEvent.click(view.getByRole("button", { name: "Import user-2" }));
  expect(importedUserIds).toEqual(["user-1"]);

  // Completing the first import releases the queued message.
  await act(async () => {
    importResolvers[0]?.("contact-1");
  });
  await waitFor(() => expect(importedUserIds).toEqual(["user-1", "user-2"]));
});

test("multiple messages queued during an import are all processed in order", async () => {
  const view = render(
    <WindowStateProvider>
      <AppNavigationProvider
        mode="windowed"
        miniApps={createMiniApps(ContactsProbe)}
      >
        <MiniAppBusProvider>
          <ImportButtons />
          <WindowLayer />
        </MiniAppBusProvider>
      </AppNavigationProvider>
    </WindowStateProvider>,
  );

  // First import starts; two more messages arrive while it is in flight.
  fireEvent.click(view.getByRole("button", { name: "Import user-1" }));
  await waitFor(() => expect(importedUserIds).toEqual(["user-1"]));
  fireEvent.click(view.getByRole("button", { name: "Import user-2" }));
  fireEvent.click(view.getByRole("button", { name: "Import user-3" }));
  expect(importedUserIds).toEqual(["user-1"]);

  // Draining the queue processes both queued messages, in arrival order.
  await act(async () => {
    importResolvers[0]?.("contact-1");
  });
  await waitFor(() => expect(importedUserIds).toEqual(["user-1", "user-2"]));
  await act(async () => {
    importResolvers[1]?.("contact-2");
  });
  await waitFor(() =>
    expect(importedUserIds).toEqual(["user-1", "user-2", "user-3"]),
  );
});

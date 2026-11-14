import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { registerAndWaitForUserId } from "../../../../test/helpers/identityPaneTestUtils";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  generateIdentityAndWaitForDb,
  getExplorerContainerItem,
  openContacts,
  openExplorer,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
} from "../../../../test/helpers/paneTestUtils";
import { renderEmptyDesktop } from "../../../../test/helpers/renderEmptyDesktop";
import {
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "../../../mini-apps/system-monitor/systemMonitorMode";
import { DeveloperModeProvider } from "../../../providers/developer-mode/DeveloperModeProvider";
import { DualPaneProvider, PaneSideProvider } from "../dual-pane";
import { PaneProvider } from "../runtime/PaneProvider";
import { Pane } from "../shell/Pane";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

async function addAddress(window: HTMLElement, label: string, street: string) {
  const scope = within(window);
  fireEvent.click(await scope.findByRole("button", { name: "Add address" }));
  const form = within(
    await scope.findByRole("form", { name: "Address editor" }),
  );
  fireEvent.change(form.getByLabelText("Label"), { target: { value: label } });
  fireEvent.change(form.getByLabelText("Street address"), {
    target: { value: street },
  });
  fireEvent.change(form.getByLabelText("Postal code"), {
    target: { value: "00123" },
  });
  fireEvent.click(form.getByRole("button", { name: "Save address" }));
  await waitFor(() => {
    expect(scope.queryByRole("form", { name: "Address editor" })).toBeNull();
    expect(scope.getByText(street)).toBeTruthy();
  });
}

test(
  "contact address edits persist and appear in Contacts and Explorer",
  async () => {
    useTestApiAppHandlers();
    saveSystemMonitorMode(systemMonitorModeStorageKey("left"), "pinned");
    const view = renderEmptyDesktop(
      <DeveloperModeProvider>
        <DualPaneProvider>
          <PaneSideProvider side="left">
            <PaneProvider
              autoProvisionEnabled
              hostConfig={createTestHostConfig()}
            >
              <Pane className="pane" />
            </PaneProvider>
          </PaneSideProvider>
        </DualPaneProvider>
      </DeveloperModeProvider>,
    );
    await generateIdentityAndWaitForDb(view);
    await registerAndWaitForUserId(view);
    const contactsWindow = await openContacts(view);
    const contacts = within(contactsWindow);
    fireEvent.click(await contacts.findByRole("menuitem", { name: "File" }));
    fireEvent.click(
      await contacts.findByRole("menuitem", { name: "New Contact" }),
    );
    fireEvent.change(await contacts.findByLabelText("First name"), {
      target: { value: "Address owner" },
    });
    fireEvent.click(contacts.getByRole("button", { name: "Create" }));
    await contacts.findByRole("heading", { name: "Address owner" });
    fireEvent.click(await contacts.findByRole("button", { name: "Edit" }));
    await addAddress(contactsWindow, "Home", "12 King Street");
    await addAddress(contactsWindow, "Work", "99 Queen Street");
    fireEvent.click(contacts.getByRole("button", { name: "Done" }));

    const explorerWindow = await openExplorer(view);
    const explorer = within(explorerWindow);
    await waitFor(() =>
      expect(getExplorerContainerItem(explorerWindow, "Contacts")).toBeTruthy(),
    );
    fireEvent.click(getExplorerContainerItem(explorerWindow, "Contacts"));
    const table = within(
      await explorer.findByRole("table", { name: "Items in Contacts" }),
    );
    fireEvent.click(
      await table.findByRole("button", { name: "Address owner" }),
    );
    await waitFor(() =>
      expect(explorerWindow.textContent).toContain("12 King Street"),
    );
    expect(explorer.getByText("99 Queen Street")).toBeTruthy();
    expect(explorer.getAllByText("00123")).toHaveLength(2);
    fireEvent.click(explorer.getByRole("button", { name: "Edit" }));
    const home = within(explorer.getByRole("group", { name: "Home" }));
    fireEvent.click(home.getByRole("button", { name: "Edit address" }));
    const editor = within(
      explorer.getByRole("form", { name: "Address editor" }),
    );
    fireEvent.change(editor.getByLabelText("City / locality"), {
      target: { value: "London" },
    });
    fireEvent.click(editor.getByRole("button", { name: "Save address" }));
    await contacts.findByText("London");
    expect(contacts.getByText("99 Queen Street")).toBeTruthy();
    fireEvent.click(
      within(explorer.getByRole("group", { name: "Work" })).getByRole(
        "button",
        { name: "Remove address" },
      ),
    );
    await waitFor(() =>
      expect(contacts.queryByText("99 Queen Street")).toBeNull(),
    );

    fireEvent.click(contacts.getByRole("button", { name: "Close window" }));
    const reopened = within(await openContacts(view));
    fireEvent.click(
      await reopened.findByRole("button", { name: "Address owner" }),
    );
    await reopened.findByText("12 King Street");
    expect(reopened.getByText("London")).toBeTruthy();
    expect(reopened.getByText("00123")).toBeTruthy();
    expect(reopened.queryByText("99 Queen Street")).toBeNull();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);

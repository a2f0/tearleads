import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { registerAndWaitForUserId } from "../../../../test/helpers/identityPaneTestUtils";
import { useTestApiAppHandlers } from "../../../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  createExplorerChildContainer,
  generateIdentityAndWaitForDb,
  getExplorerContainerItem,
  getPaneStatusText,
  moveExplorerContainer,
  openContacts,
  openExplorer,
  openExplorerNewStructuredDocumentRoute,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
  waitForPaneRuntimeToSettle,
} from "../../../../test/helpers/paneTestUtils";
import { renderRoutedPane } from "../../../../test/helpers/routedPaneTestUtils";

afterEach(cleanupPaneTestEnvironment);

async function openRoutedSystemMonitorStatus(
  view: ReturnType<typeof renderPane>,
) {
  fireEvent.click(view.getByRole("button", { name: "Expand navigation rail" }));
  fireEvent.click(view.getByRole("link", { name: "System Monitor" }));
  fireEvent.click(await view.findByRole("tab", { name: "Status" }));
  await waitFor(() => {
    expect(getPaneStatusText(view)).toMatch(/network:/);
  });
}

// The routed nav rail is a pure app launcher, so the manual network controls
// live on the System Monitor's own context menu (as they do in windowed mode).
async function clickRoutedNetworkModeItem(
  view: ReturnType<typeof renderPane>,
  label: string,
) {
  const systemMonitor =
    view.container.querySelector<HTMLElement>(".system-monitor");
  invariant(systemMonitor, "routed system monitor app root not found");

  fireEvent.contextMenu(systemMonitor, { clientX: 30, clientY: 30 });
  fireEvent.click(await view.findByRole("button", { name: label }));
}

async function expectExplorerSystemContainerContextMenuItems(
  view: ReturnType<typeof renderPane>,
  explorerWindow: HTMLElement,
  containerName: "Contacts" | "Trash",
) {
  fireEvent.contextMenu(
    getExplorerContainerItem(explorerWindow, containerName),
    {
      clientX: 190,
      clientY: 190,
    },
  );

  // Scope assertions to the context menu: the Explorer window's toolbar row
  // now carries same-named buttons (e.g. "New Contact") whenever a container
  // is active, so a global query would collide.
  const menu = await waitFor(() => {
    const element = view.baseElement.querySelector<HTMLElement>(".menu");
    invariant(element, "explorer context menu not found");
    return element;
  });

  expect(within(menu).getByRole("button", { name: "Get Info" })).toBeTruthy();
  expect(
    within(menu).queryByRole("button", { name: "Create Child Folder" }),
  ).toBeNull();
  expect(
    within(menu).queryByRole("button", { name: "New Document" }),
  ).toBeNull();
  expect(within(menu).queryByRole("button", { name: "Upload" })).toBeNull();
  expect(within(menu).queryByRole("button", { name: "Rename" })).toBeNull();
  expect(within(menu).queryByRole("button", { name: "Move" })).toBeNull();
  expect(
    within(menu).queryByRole("button", { name: "Move to Trash" }),
  ).toBeNull();

  const newContactItem = within(menu).queryByRole("button", {
    name: "New Contact",
  });
  expect(newContactItem !== null).toBe(containerName === "Contacts");

  fireEvent.mouseDown(document.body);
  await waitFor(() => {
    expect(view.baseElement.querySelector(".menu")).toBeNull();
  });
}

async function expectExplorerNewStructuredDocumentFileMenuDisabled(
  explorerWindow: HTMLElement,
) {
  fireEvent.click(
    within(explorerWindow).getByRole("menuitem", { name: "File" }),
  );

  const newStructuredDocumentItem = await within(explorerWindow).findByRole(
    "menuitem",
    { name: "New Document" },
  );
  invariant(
    newStructuredDocumentItem instanceof HTMLButtonElement,
    "Expected New Document file menu item.",
  );
  expect(newStructuredDocumentItem.disabled).toBe(true);

  fireEvent.click(
    within(explorerWindow).getByRole("menuitem", { name: "File" }),
  );
}

test("routed system monitor manually controls the app network mode", async () => {
  const view = renderRoutedPane();
  await openRoutedSystemMonitorStatus(view);

  fireEvent(window, new Event("online"));
  await waitFor(() => {
    expect(getPaneStatusText(view)).toMatch(/network:\s*online/);
  });

  await clickRoutedNetworkModeItem(view, "Force Online");

  await waitFor(() => {
    expect(getPaneStatusText(view)).toMatch(/network:\s*online \(manual\)/);
  });

  fireEvent(window, new Event("offline"));
  expect(getPaneStatusText(view)).toMatch(/network:\s*online \(manual\)/);

  await clickRoutedNetworkModeItem(view, "Use Automatic Network");

  await waitFor(() => {
    expect(getPaneStatusText(view)).toMatch(/network:\s*offline/);
    expect(getPaneStatusText(view)).not.toMatch(
      /network:\s*offline \(manual\)/,
    );
  });

  await clickRoutedNetworkModeItem(view, "Force Offline");

  await waitFor(() => {
    expect(getPaneStatusText(view)).toMatch(/network:\s*offline \(manual\)/);
  });

  fireEvent(window, new Event("online"));
  expect(getPaneStatusText(view)).toMatch(/network:\s*offline \(manual\)/);

  await clickRoutedNetworkModeItem(view, "Use Automatic Network");

  await waitFor(() => {
    expect(getPaneStatusText(view)).toMatch(/network:\s*online/);
    expect(getPaneStatusText(view)).not.toMatch(/network:\s*online \(manual\)/);
  });

  view.unmount();
});

test(
  "contacts windows in the same pane share live contact document state",
  async () => {
    const peerUserId = "11111111-1111-4111-8111-111111111111";
    const view = renderPane();
    await generateIdentityAndWaitForDb(view);
    await registerAndWaitForUserId(view);

    await openContacts(view);
    await openContacts(view);

    await waitFor(() => {
      const contactsApps = Array.from(
        view.container.querySelectorAll<HTMLDivElement>(".contacts"),
      );
      expect(contactsApps).toHaveLength(2);
    });

    const contactsApps =
      view.container.querySelectorAll<HTMLDivElement>(".contacts");
    const firstContactsApp = contactsApps[0];

    invariant(firstContactsApp, "first contacts app not found");
    const firstContactsWindow = firstContactsApp.closest(".window");
    invariant(
      firstContactsWindow instanceof HTMLDivElement,
      "first contacts window not found",
    );

    expect(
      within(firstContactsApp).queryByLabelText("Contact user ID"),
    ).toBeNull();

    fireEvent.click(within(firstContactsWindow).getByText("File"));
    let importContactMenuItem: HTMLButtonElement | null = null;
    await waitFor(() => {
      expect(within(firstContactsWindow).getByText("New Contact")).toBeTruthy();
      const menuItem = within(firstContactsWindow).getByRole("menuitem", {
        name: "Import Contact",
      });
      invariant(
        menuItem instanceof HTMLButtonElement,
        "import contact menu item not found",
      );
      expect(menuItem.disabled).toBe(false);
      importContactMenuItem = menuItem;
    });
    invariant(importContactMenuItem, "import contact menu item not found");
    fireEvent.click(importContactMenuItem);

    const firstInput = await view.findByLabelText("Contact user ID");
    invariant(firstInput, "contact input not found");

    fireEvent.change(firstInput, {
      target: { value: peerUserId },
    });

    const updatedFirstContactsApp = view
      .getByDisplayValue(peerUserId)
      .closest(".contacts");
    invariant(
      updatedFirstContactsApp instanceof HTMLDivElement,
      "updated first contacts app not found",
    );
    // The import submit action now lives in the window toolbar row (window
    // chrome), not inside the .contacts body, so query the whole window.
    const updatedFirstContactsWindow =
      updatedFirstContactsApp.closest(".window");
    invariant(
      updatedFirstContactsWindow instanceof HTMLDivElement,
      "updated first contacts window not found",
    );

    await waitFor(() => {
      const importButton = within(updatedFirstContactsWindow).getByRole(
        "button",
        { name: "Import" },
      );
      invariant(
        importButton instanceof HTMLButtonElement,
        "contact import button not found",
      );
      expect(importButton.disabled).toBe(false);
    });

    const firstImportButton = within(updatedFirstContactsWindow).getByRole(
      "button",
      {
        name: "Import",
      },
    );
    invariant(
      firstImportButton instanceof HTMLButtonElement,
      "contact import button not found",
    );

    fireEvent.click(firstImportButton);

    await waitFor(() => {
      expect(view.getAllByText("11111111")).toHaveLength(2);
    });

    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "system bootstrap provisions one self contact before login",
  async () => {
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);

    const contactsWindow = await openContacts(view);
    await waitFor(
      () => {
        expect(
          within(contactsWindow).getAllByRole("button", { name: "You" }),
        ).toHaveLength(1);
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );

    await registerAndWaitForUserId(view);
    await waitFor(
      () => {
        expect(
          within(contactsWindow).getAllByRole("button", { name: "You" }),
        ).toHaveLength(1);
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );

    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "explorer labels the provisioned self contact as You",
  async () => {
    useTestApiAppHandlers();
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);
    await registerAndWaitForUserId(view);

    const contactsWindow = await openContacts(view);
    await waitFor(
      () => {
        expect(
          within(contactsWindow).getByRole("button", { name: "You" }),
        ).toBeTruthy();
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );

    const explorer = await openExplorer(view);
    await waitFor(
      () => {
        expect(getExplorerContainerItem(explorer, "Contacts")).toBeTruthy();
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );

    fireEvent.click(getExplorerContainerItem(explorer, "Contacts"));
    await waitFor(
      () => {
        const contactsItemsTable = within(explorer).getByRole("table", {
          name: "Items in Contacts",
        });
        expect(
          within(contactsItemsTable).getByRole("button", { name: "You" }),
        ).toBeTruthy();
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );

    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "system bootstrap provisions the self contact without opening contacts first",
  async () => {
    useTestApiAppHandlers();
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);
    await registerAndWaitForUserId(view);

    const explorer = await openExplorer(view);
    await waitFor(
      () => {
        expect(getExplorerContainerItem(explorer, "Contacts")).toBeTruthy();
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );

    fireEvent.click(getExplorerContainerItem(explorer, "Contacts"));
    await waitFor(
      () => {
        const contactsItemsTable = within(explorer).getByRole("table", {
          name: "Items in Contacts",
        });
        expect(
          within(contactsItemsTable).getByRole("button", { name: "You" }),
        ).toBeTruthy();
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );

    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);

test("explorer exposes structured document creation from the file menu", async () => {
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);

  const explorer = await openExplorer(view);

  expect(within(explorer).queryByRole("button", { name: "Note" })).toBeNull();

  await openExplorerNewStructuredDocumentRoute(explorer);

  // Exit the new-document route by selecting the root container in the sidebar
  // (the "Back to Container" toolbar button was removed).
  fireEvent.click(getExplorerContainerItem(explorer, "/"));

  await waitFor(() => {
    expect(
      within(explorer).getByRole("table", { name: "Items in /" }),
    ).toBeTruthy();
  });
  expect(within(explorer).queryByRole("button", { name: "Note" })).toBeNull();

  view.unmount();
});

test(
  "registered explorer shows user system containers",
  async () => {
    useTestApiAppHandlers();
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);
    await registerAndWaitForUserId(view);

    const explorer = await openExplorer(view);

    await waitFor(
      () => {
        expect(getExplorerContainerItem(explorer, "Contacts")).toBeTruthy();
        expect(getExplorerContainerItem(explorer, "Trash")).toBeTruthy();
        const rootItemsTable = within(explorer).getByRole("table", {
          name: "Items in /",
        });
        expect(
          within(rootItemsTable).getByRole("button", { name: "Contacts" }),
        ).toBeTruthy();
        expect(
          within(rootItemsTable).getByRole("button", { name: "Trash" }),
        ).toBeTruthy();
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );

    await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);

    await expectExplorerSystemContainerContextMenuItems(
      view,
      explorer,
      "Contacts",
    );
    await expectExplorerNewStructuredDocumentFileMenuDisabled(explorer);
    await expectExplorerSystemContainerContextMenuItems(
      view,
      explorer,
      "Trash",
    );
    await expectExplorerNewStructuredDocumentFileMenuDisabled(explorer);

    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "device-first explorer can move a local child container under a sibling",
  async () => {
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);

    const explorer = await openExplorer(view);

    await createExplorerChildContainer(view, explorer, "test1");
    await createExplorerChildContainer(view, explorer, "test2");
    await moveExplorerContainer(view, explorer, "test1", "test2");

    fireEvent.click(getExplorerContainerItem(explorer, "test2"));

    await waitFor(
      () => {
        expect(
          within(explorer).getByRole("table", { name: "Items in test2" }),
        ).toBeTruthy();
        expect(
          within(explorer).getByRole("button", { name: "test1" }),
        ).toBeTruthy();
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );

    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);

import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { useTestApiAppHandlers } from "../../../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  createExplorerChildContainer,
  generateIdentityAndWaitForDb,
  getExplorerContainerItem,
  getPaneStatusText,
  getSelectedExplorerContainerSyncLabel,
  moveExplorerContainer,
  openContacts,
  openExplorer,
  openExplorerNewStructuredDocumentRoute,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  registerAndWaitForUserId,
  renderPane,
  summarizeProxiedApiRequests,
  waitForPaneRuntimeToSettle,
} from "../../../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment);

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

  expect(
    await view.findByRole("button", {
      name: "Get Info",
    }),
  ).toBeTruthy();
  expect(
    view.queryByRole("button", { name: "Create Child Folder" }),
  ).toBeNull();
  expect(
    view.queryByRole("button", {
      name: "New Document",
    }),
  ).toBeNull();
  expect(view.queryByRole("button", { name: "Upload" })).toBeNull();
  expect(view.queryByRole("button", { name: "Rename" })).toBeNull();
  expect(view.queryByRole("button", { name: "Move" })).toBeNull();
  expect(view.queryByRole("button", { name: "Delete" })).toBeNull();

  const newContactItem = view.queryByRole("button", {
    name: "New Contact",
  });
  expect(newContactItem !== null).toBe(containerName === "Contacts");

  fireEvent.mouseDown(document.body);
  await waitFor(() => {
    expect(view.queryByRole("button", { name: "Get Info" })).toBeNull();
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

test("pane menu manually controls the app network mode", async () => {
  const view = renderPane();

  fireEvent(window, new Event("online"));
  await waitFor(() => {
    expect(getPaneStatusText(view)).toMatch(/network:\s*online/);
  });

  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByRole("button", { name: "Force Online" }));

  await waitFor(() => {
    expect(getPaneStatusText(view)).toMatch(/network:\s*online \(manual\)/);
  });

  fireEvent(window, new Event("offline"));
  expect(getPaneStatusText(view)).toMatch(/network:\s*online \(manual\)/);

  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByRole("button", { name: "Use Automatic Network" }));

  await waitFor(() => {
    expect(getPaneStatusText(view)).toMatch(/network:\s*offline/);
    expect(getPaneStatusText(view)).not.toMatch(
      /network:\s*offline \(manual\)/,
    );
  });

  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByRole("button", { name: "Force Offline" }));

  await waitFor(() => {
    expect(getPaneStatusText(view)).toMatch(/network:\s*offline \(manual\)/);
  });

  fireEvent(window, new Event("online"));
  expect(getPaneStatusText(view)).toMatch(/network:\s*offline \(manual\)/);

  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByRole("button", { name: "Use Automatic Network" }));

  await waitFor(() => {
    expect(getPaneStatusText(view)).toMatch(/network:\s*online/);
    expect(getPaneStatusText(view)).not.toMatch(/network:\s*online \(manual\)/);
  });

  view.unmount();
});

test("contacts windows in the same pane share live contact document state", async () => {
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);
  await registerAndWaitForUserId(view);

  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 120,
    clientY: 120,
  });
  fireEvent.click(view.getByText("Open Contacts"));
  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 160,
    clientY: 160,
  });
  fireEvent.click(view.getByText("Open Contacts"));

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

  const firstInput =
    await within(firstContactsApp).findByLabelText("Contact user ID");
  invariant(firstInput, "contact input not found");

  fireEvent.change(firstInput, {
    target: { value: "peer-user-1" },
  });

  const updatedFirstContactsApp = view
    .getByDisplayValue("peer-user-1")
    .closest(".contacts");

  await waitFor(() => {
    invariant(
      updatedFirstContactsApp instanceof HTMLDivElement,
      "updated first contacts app not found",
    );
    const importButton = within(updatedFirstContactsApp).getByRole("button", {
      name: "Import",
    });
    invariant(
      importButton instanceof HTMLButtonElement,
      "contact import button not found",
    );
    expect(importButton.disabled).toBe(false);
  });

  invariant(
    updatedFirstContactsApp instanceof HTMLDivElement,
    "updated first contacts app not found",
  );

  const firstImportButton = within(updatedFirstContactsApp).getByRole(
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
    expect(view.getAllByText("peer")).toHaveLength(2);
  });

  view.unmount();
});

test(
  "contacts app provisions one self contact before login",
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
  "explorer provisions the self contact without opening contacts first",
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

  expect(
    within(explorer).queryByRole("button", { name: "New Note" }),
  ).toBeNull();

  await openExplorerNewStructuredDocumentRoute(explorer);

  fireEvent.click(
    within(explorer).getByRole("button", { name: "Back to Container" }),
  );

  await waitFor(() => {
    expect(
      within(explorer).getByRole("table", { name: "Items in /" }),
    ).toBeTruthy();
  });
  expect(
    within(explorer).queryByRole("button", { name: "New Note" }),
  ).toBeNull();

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

test("registered explorer child folders settle to synced in the pane UI", async () => {
  useTestApiAppHandlers();
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);
  await registerAndWaitForUserId(view);
  const explorer = await openExplorer(view);

  await waitFor(() => {
    expect(getExplorerContainerItem(explorer, "/")).toBeTruthy();
  });

  await createExplorerChildContainer(view, explorer, "Docs");
  await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);

  await waitFor(
    () => {
      expect(
        getSelectedExplorerContainerSyncLabel(explorer),
        `Child folder did not sync.\nrequests=\n${summarizeProxiedApiRequests()}`,
      ).toBe("Synced");
    },
    { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
  );

  view.unmount();
}, 30_000);

import { afterEach, expect, test } from "bun:test";
import {
  createLocalKeyring,
  createMemoryLocalKeyringManifestStore,
  createMemoryWrappingKeyKeystore,
  type LocalKeyring,
} from "@tearleads/client-sdk";
import { createModuleSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import {
  AppTestRuntimeScopeProbe,
  waitForAppTestRuntimeToSettle,
} from "../../../test/helpers/appRuntimeIdle";
import { MockWorker } from "../../../test/helpers/mockWorker";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
  wsUrl,
} from "../../../test/helpers/mswServer";
import { AppHostConfig } from "../../host/AppHostConfig";
import { DualPaneProvider, PaneSideProvider } from "./DualPaneProvider";
import { Pane } from "./Pane";
import { PaneProvider } from "./PaneProvider";

const PANE_ASYNC_TEST_TIMEOUT_MS = 15_000;
const PANE_LONG_ASYNC_TEST_TIMEOUT_MS = 30_000;

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

function createTestHostConfig(
  options: {
    readonly createLocalKeyring?: (() => LocalKeyring) | undefined;
    readonly localIdentityNamespace?: string | undefined;
  } = {},
) {
  return new AppHostConfig(
    "http://localhost:3001",
    wsUrl,
    () =>
      createModuleSQLiteRuntime({
        workerConstructor: MockWorker,
      }),
    undefined,
    options.localIdentityNamespace,
    options.createLocalKeyring,
  );
}

function createSharedMemoryLocalKeyringFactory(): () => LocalKeyring {
  const keystore = createMemoryWrappingKeyKeystore();
  const manifestStore = createMemoryLocalKeyringManifestStore();

  return () => createLocalKeyring({ keystore, manifestStore });
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function createDelayedLoadLocalKeyringFactory(
  createBaseLocalKeyring: () => LocalKeyring,
) {
  const loadStarted = createDeferred();
  const loadFinished = createDeferred();
  const releaseLoad = createDeferred();

  return {
    createLocalKeyring: (): LocalKeyring => {
      const keyring = createBaseLocalKeyring();

      return {
        deleteSession: (scope) => keyring.deleteSession(scope),
        getOrCreateSession: (scope) => keyring.getOrCreateSession(scope),
        loadSession: async (scope) => {
          loadStarted.resolve();
          await releaseLoad.promise;
          try {
            return await keyring.loadSession(scope);
          } finally {
            loadFinished.resolve();
          }
        },
      };
    },
    waitForLoadSessionResult: () => loadFinished.promise,
    releaseLoadSession: () => releaseLoad.resolve(),
    waitForLoadSession: () => loadStarted.promise,
  };
}

function renderPane({
  hostConfig = createTestHostConfig(),
}: {
  readonly hostConfig?: AppHostConfig | undefined;
} = {}) {
  return render(
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={hostConfig}>
          <AppTestRuntimeScopeProbe />
          <Pane className="pane" />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>,
  );
}

async function openExplorer(view: ReturnType<typeof renderPane>) {
  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 120,
    clientY: 120,
  });
  fireEvent.click(view.getByText("Open Explorer"));

  let explorerWindow: HTMLDivElement | null = null;
  await waitFor(() => {
    const windows =
      view.container.querySelectorAll<HTMLDivElement>("div.window");
    explorerWindow = windows[windows.length - 1] ?? null;
    expect(explorerWindow).toBeTruthy();
  });

  invariant(explorerWindow, "explorer window not found");
  const readyExplorerWindow = explorerWindow;

  await waitFor(() => {
    expect(
      within(readyExplorerWindow).getByRole("table", { name: "Items in /" }),
    ).toBeTruthy();
  });

  return readyExplorerWindow;
}

async function openExplorerNewStructuredDocumentRoute(
  explorerWindow: HTMLElement,
) {
  fireEvent.click(within(explorerWindow).getByText("File"));

  const newStructuredDocumentItem = await within(explorerWindow).findByRole(
    "menuitem",
    {
      name: "New Structured Document",
    },
  );
  fireEvent.click(newStructuredDocumentItem);

  await waitFor(() => {
    expect(
      within(explorerWindow).getByRole("button", { name: "New Note" }),
    ).toBeTruthy();
  });
}

async function openNotes(view: ReturnType<typeof renderPane>) {
  const existingWindowCount =
    view.container.querySelectorAll<HTMLDivElement>("div.window").length;

  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 160,
    clientY: 160,
  });
  fireEvent.click(view.getByText("Open Notes"));

  let notesWindow: HTMLDivElement | null = null;
  await waitFor(() => {
    const windows =
      view.container.querySelectorAll<HTMLDivElement>("div.window");
    expect(windows.length).toBeGreaterThan(existingWindowCount);
    notesWindow = windows[windows.length - 1] ?? null;
    expect(notesWindow).toBeTruthy();
  });

  if (!notesWindow) {
    throw new Error("notes window not found");
  }
  const readyNotesWindow: HTMLDivElement = notesWindow;

  await waitFor(() => {
    expect(
      readyNotesWindow.querySelector<HTMLTextAreaElement>(
        "textarea.notes-editor",
      ),
    ).toBeTruthy();
  });

  return readyNotesWindow;
}

async function openContacts(view: ReturnType<typeof renderPane>) {
  const existingWindowCount =
    view.container.querySelectorAll<HTMLDivElement>("div.window").length;

  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 120,
    clientY: 120,
  });
  fireEvent.click(view.getByText("Open Contacts"));

  let contactsWindow: HTMLDivElement | null = null;
  await waitFor(() => {
    const windows =
      view.container.querySelectorAll<HTMLDivElement>("div.window");
    expect(windows.length).toBeGreaterThan(existingWindowCount);
    const contactsApps =
      view.container.querySelectorAll<HTMLDivElement>(".contacts");
    const contactsApp = contactsApps[contactsApps.length - 1] ?? null;
    expect(contactsApp).toBeTruthy();
    contactsWindow = contactsApp?.closest(".window") as HTMLDivElement | null;
    expect(contactsWindow).toBeTruthy();
  });

  invariant(contactsWindow, "contacts window not found");
  return contactsWindow;
}

function listExplorerNoteItems(
  explorerWindow: HTMLElement,
): HTMLButtonElement[] {
  return Array.from(
    explorerWindow.querySelectorAll<HTMLButtonElement>(
      "button.explorer-sidebar-item--note",
    ),
  );
}

function listExplorerContainerItems(
  explorerWindow: HTMLElement,
): HTMLButtonElement[] {
  return Array.from(
    explorerWindow.querySelectorAll<HTMLButtonElement>(
      "button.explorer-sidebar-item",
    ),
  ).filter(
    (button) => !button.classList.contains("explorer-sidebar-item--note"),
  );
}

function getExplorerContainerItem(
  explorerWindow: HTMLElement,
  name: string,
): HTMLButtonElement {
  const item = listExplorerContainerItems(explorerWindow).find(
    (button) => button.textContent?.trim() === name,
  );
  invariant(item, `Expected explorer container item "${name}".`);
  return item;
}

async function createExplorerChildContainer(
  view: ReturnType<typeof renderPane>,
  explorerWindow: HTMLElement,
  name: string,
) {
  fireEvent.contextMenu(getExplorerContainerItem(explorerWindow, "/"), {
    clientX: 180,
    clientY: 180,
  });
  fireEvent.click(view.getByRole("button", { name: "Create Child" }));

  const containerNameInput = view.getByLabelText("Container name");
  invariant(
    containerNameInput instanceof HTMLInputElement,
    "Expected container name input.",
  );
  fireEvent.change(containerNameInput, { target: { value: name } });
  fireEvent.click(view.getByRole("button", { name: "Create" }));

  await waitFor(
    () => {
      expect(getExplorerContainerItem(explorerWindow, name)).toBeTruthy();
    },
    { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
  );
}

async function moveExplorerContainer(
  view: ReturnType<typeof renderPane>,
  explorerWindow: HTMLElement,
  name: string,
  destinationName: string,
) {
  fireEvent.contextMenu(getExplorerContainerItem(explorerWindow, name), {
    clientX: 210,
    clientY: 210,
  });
  fireEvent.click(view.getByRole("button", { name: "Move" }));

  const dialog = view.getByRole("dialog");
  const destinationSelect = within(dialog).getByLabelText(
    "Destination container",
  );
  invariant(
    destinationSelect instanceof HTMLSelectElement,
    "Expected destination container select.",
  );
  const destinationOption = Array.from(destinationSelect.options).find(
    (option) => option.textContent?.startsWith(`${destinationName} (`),
  );
  invariant(
    destinationOption,
    `Expected destination option for "${destinationName}".`,
  );

  fireEvent.change(destinationSelect, {
    target: { value: destinationOption.value },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));

  await waitFor(() => {
    expect(view.queryByRole("dialog")).toBeNull();
  });
}

function getSelectedExplorerContainerSyncLabel(
  explorerWindow: HTMLElement,
): string | null {
  const badge = explorerWindow.querySelector<HTMLElement>(
    ".explorer-detail-title-row .explorer-sync-badge",
  );
  return badge?.getAttribute("aria-label") ?? null;
}

function summarizeProxiedApiRequests(): string {
  return listProxiedApiRequests()
    .map((request) => {
      const path = new URL(request.url).pathname;
      const response = (() => {
        try {
          const parsed = JSON.parse(request.responseBody) as unknown;
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            "error" in parsed
          ) {
            return ` ${String(Reflect.get(parsed, "error"))}`;
          }
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            "acceptedOutgoingUpdateIds" in parsed
          ) {
            const ids = Reflect.get(parsed, "acceptedOutgoingUpdateIds");
            return ` accepted=${Array.isArray(ids) ? ids.length : "?"}`;
          }
        } catch {
          // fall through to status-only summary
        }
        return "";
      })();
      return `${request.method} ${path} ${request.status}${response}`;
    })
    .join("\n");
}

async function waitForPaneRuntimeToSettle(
  timeoutMs = PANE_ASYNC_TEST_TIMEOUT_MS,
): Promise<void> {
  let settled = false;
  await act(async () => {
    settled = await waitForAppTestRuntimeToSettle({
      apiQuietMs: 25,
      timeoutMs,
    });
  });
  expect(
    settled,
    `Pane runtime did not settle.\nrequests=\n${summarizeProxiedApiRequests()}`,
  ).toBe(true);
}

const userIdStatusPattern =
  /userId:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/u;
const publicKeyStatusPattern = /publicKey:\s*([0-9a-f]+)/u;

function getPanePublicKey(view: ReturnType<typeof renderPane>): string {
  const statusText =
    view.container.querySelector(".pane-content")?.textContent ?? "";
  const match = publicKeyStatusPattern.exec(statusText);
  invariant(match?.[1], "Expected pane public key.");
  return match[1];
}

async function generateIdentityAndWaitForDb(
  view: ReturnType<typeof renderPane>,
) {
  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Generate Key Pair"));

  await waitFor(() => {
    expect(view.getByText(/sqlite worker: ready/)).toBeTruthy();
    expect(view.queryByText(/publicKey: none/)).toBeNull();
  });
}

async function registerAndWaitForUserId(
  view: ReturnType<typeof renderPane>,
): Promise<string> {
  fireEvent.click(view.getByText("Menu"));
  await waitFor(() => {
    expect(view.getByText("Register")).toBeTruthy();
    expect(view.getByText("Login")).toBeTruthy();
  });
  fireEvent.click(view.getByText("Register"));

  let userId = "";
  await waitFor(
    () => {
      const statusText =
        view.container.querySelector(".pane-content")?.textContent ?? "";
      const match = userIdStatusPattern.exec(statusText);
      expect(match).toBeTruthy();
      userId = match?.[1] ?? "";
    },
    { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
  );
  await waitFor(() => {
    expect(view.queryByText("Register")).toBeNull();
  });

  return userId;
}

test("renders the boot prompt in the pane log", () => {
  const view = renderPane();

  const prompt = view.getByText(
    /Generate a key pair from the pane menu to boot this pane\./,
  );
  expect(prompt.parentElement?.classList.contains("pane-log")).toBe(true);

  view.unmount();
});

test("unbooted pane context menu can generate a key pair", async () => {
  const view = renderPane();

  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 120,
    clientY: 120,
  });

  expect(view.getByText("Generate Key Pair")).toBeTruthy();
  expect(view.queryByText("Open Notes")).toBeNull();

  fireEvent.click(view.getByText("Generate Key Pair"));

  await waitFor(() => {
    expect(view.getByText(/sqlite worker: ready/)).toBeTruthy();
    expect(view.queryByText(/publicKey: none/)).toBeNull();
  });

  view.unmount();
});

test("generated pane key pair rehydrates after remount", async () => {
  const hostConfig = createTestHostConfig({
    createLocalKeyring: createSharedMemoryLocalKeyringFactory(),
    localIdentityNamespace: `test-pane-reload-${crypto.randomUUID()}`,
  });
  const view = renderPane({ hostConfig });

  await generateIdentityAndWaitForDb(view);
  await waitFor(() => {
    expect(view.getByText(/Local identity key package persisted/)).toBeTruthy();
  });
  view.unmount();

  const reloadedView = renderPane({ hostConfig });
  await waitFor(
    () => {
      expect(reloadedView.getByText(/sqlite worker: ready/)).toBeTruthy();
      expect(reloadedView.queryByText(/publicKey: none/)).toBeNull();
      expect(
        reloadedView.getByText(/Local identity key package restored/),
      ).toBeTruthy();
    },
    { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
  );

  fireEvent.contextMenu(reloadedView.getByRole("application"), {
    clientX: 120,
    clientY: 120,
  });
  expect(reloadedView.queryByText("Generate Key Pair")).toBeNull();
  expect(reloadedView.getByText("Open Notes")).toBeTruthy();

  reloadedView.unmount();
});

test("local identity restore does not overwrite generate clicks while loading", async () => {
  const createSharedLocalKeyring = createSharedMemoryLocalKeyringFactory();
  const localIdentityNamespace = `test-pane-restore-race-${crypto.randomUUID()}`;
  const initialHostConfig = createTestHostConfig({
    createLocalKeyring: createSharedLocalKeyring,
    localIdentityNamespace,
  });
  const view = renderPane({ hostConfig: initialHostConfig });

  await generateIdentityAndWaitForDb(view);
  await waitFor(() => {
    expect(view.getByText(/Local identity key package persisted/)).toBeTruthy();
  });
  const persistedPublicKey = getPanePublicKey(view);
  view.unmount();

  const delayedLocalKeyring = createDelayedLoadLocalKeyringFactory(
    createSharedLocalKeyring,
  );
  const reloadedHostConfig = createTestHostConfig({
    createLocalKeyring: delayedLocalKeyring.createLocalKeyring,
    localIdentityNamespace,
  });
  const reloadedView = renderPane({ hostConfig: reloadedHostConfig });

  await delayedLocalKeyring.waitForLoadSession();
  fireEvent.click(reloadedView.getByText("Menu"));
  fireEvent.click(reloadedView.getByText("Generate Key Pair"));

  await waitFor(
    () => {
      expect(reloadedView.getByText(/sqlite worker: ready/)).toBeTruthy();
      expect(reloadedView.queryByText(/publicKey: none/)).toBeNull();
    },
    { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
  );
  const generatedPublicKey = getPanePublicKey(reloadedView);
  expect(generatedPublicKey).not.toBe(persistedPublicKey);

  delayedLocalKeyring.releaseLoadSession();
  await act(async () => {
    await delayedLocalKeyring.waitForLoadSessionResult();
    await Promise.resolve();
  });

  expect(getPanePublicKey(reloadedView)).toBe(generatedPublicKey);
  expect(reloadedView.queryByText(/Local identity key package restored/)).toBe(
    null,
  );

  reloadedView.unmount();
});

test("displays userId after registration", async () => {
  const view = renderPane();

  expect(view.getByText(/userId: none/)).toBeTruthy();

  await generateIdentityAndWaitForDb(view);
  const userId = await registerAndWaitForUserId(view);

  await waitFor(() => {
    expect(view.getByText(new RegExp(`userId: ${userId}`))).toBeTruthy();
  });

  fireEvent.click(view.getByText("Menu"));
  expect(view.queryByText("Register")).toBeNull();
  expect(view.queryByText("Login")).toBeNull();

  view.unmount();
});

test("logged-in pane menu can log out", async () => {
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);
  const userId = await registerAndWaitForUserId(view);

  await waitFor(() => {
    expect(view.getByText(new RegExp(`userId: ${userId}`))).toBeTruthy();
    expect(view.queryByText(/session: none/)).toBeNull();
  });

  fireEvent.click(view.getByText("Menu"));
  expect(view.getByText("Destroy Key Pair")).toBeTruthy();
  expect(view.getByText("Logout")).toBeTruthy();

  fireEvent.click(view.getByText("Logout"));

  await waitFor(() => {
    expect(view.getByText(/session: none/)).toBeTruthy();
    expect(view.getByText(new RegExp(`userId: ${userId}`))).toBeTruthy();
  });

  view.unmount();
});

test("identity manager opens from the pane and lists active sessions", async () => {
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);
  await registerAndWaitForUserId(view);

  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 120,
    clientY: 120,
  });
  fireEvent.click(view.getByText("Open Identity Manager"));

  await waitFor(() => {
    expect(view.getByText("Identity Manager")).toBeTruthy();
    expect(view.getByText("Active Sessions")).toBeTruthy();
    expect(view.getByText("Current")).toBeTruthy();
    expect(view.getByText("Backup Key Package")).toBeTruthy();
  });
  expect(view.container.querySelector(".window-sidebar-layout")).toBeNull();

  view.unmount();
});

test("userId resets to none when key pair is destroyed", async () => {
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);
  const userId = await registerAndWaitForUserId(view);

  await waitFor(() => {
    expect(view.getByText(new RegExp(`userId: ${userId}`))).toBeTruthy();
  });

  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Destroy Key Pair"));

  await waitFor(() => {
    expect(view.getByText(/userId: none/)).toBeTruthy();
  });

  view.unmount();
});

test("notes windows in the same pane share live note state", async () => {
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);

  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 120,
    clientY: 120,
  });
  fireEvent.click(view.getByText("Open Notes"));
  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 160,
    clientY: 160,
  });
  fireEvent.click(view.getByText("Open Notes"));

  await waitFor(() => {
    const editors = Array.from(
      view.container.querySelectorAll<HTMLTextAreaElement>(
        "textarea.notes-editor",
      ),
    );
    expect(editors).toHaveLength(2);
    for (const editor of editors) {
      expect(editor.disabled).toBe(false);
    }
  });

  const noteEditors = view.container.querySelectorAll<HTMLTextAreaElement>(
    "textarea.notes-editor",
  );
  const firstEditor = noteEditors[0];
  const secondEditor = noteEditors[1];

  invariant(firstEditor, "first editor not found");
  invariant(secondEditor, "second editor not found");

  fireEvent.change(firstEditor, {
    target: { value: "shared pane note" },
  });

  await waitFor(() => {
    expect(firstEditor.value).toBe("shared pane note");
    expect(secondEditor.value).toBe("shared pane note");
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
  "contacts app provisions the self contact without opening explorer",
  async () => {
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

    await waitFor(() => {
      expect(
        within(explorer).getByRole("table", { name: "Items in test2" }),
      ).toBeTruthy();
      expect(
        within(explorer).getByRole("button", { name: "test1" }),
      ).toBeTruthy();
    });

    view.unmount();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

test("explorer windows in the same pane share newly created notes without refresh", async () => {
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);

  const firstExplorer = await openExplorer(view);
  const secondExplorer = await openExplorer(view);

  await waitFor(() => {
    expect(listExplorerNoteItems(secondExplorer)).toHaveLength(0);
  });

  await openExplorerNewStructuredDocumentRoute(firstExplorer);
  fireEvent.click(
    within(firstExplorer).getByRole("button", { name: "New Note" }),
  );

  await waitFor(() => {
    expect(
      within(firstExplorer).getByRole("button", { name: "Back to Container" }),
    ).toBeTruthy();
  });

  const editor = await within(firstExplorer).findByRole("textbox", {
    name: /Notes editor/,
  });
  invariant(editor instanceof HTMLTextAreaElement, "note editor not found");

  fireEvent.change(editor, {
    target: { value: "fresh explorer note" },
  });

  await waitFor(() => {
    expect(editor.value).toBe("fresh explorer note");
    expect(
      listExplorerNoteItems(firstExplorer).some(
        (button) => button.textContent?.trim() === "fresh explorer note",
      ),
    ).toBe(true);
  });

  await waitFor(() => {
    expect(
      listExplorerNoteItems(secondExplorer).some(
        (button) => button.textContent?.trim() === "fresh explorer note",
      ),
    ).toBe(true);
  });

  view.unmount();
});

test("notes app lists notes created from explorer", async () => {
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);

  const explorer = await openExplorer(view);

  await openExplorerNewStructuredDocumentRoute(explorer);
  fireEvent.click(within(explorer).getByRole("button", { name: "New Note" }));

  const editor = await within(explorer).findByRole("textbox", {
    name: /Notes editor/,
  });
  invariant(editor instanceof HTMLTextAreaElement, "note editor not found");

  fireEvent.change(editor, {
    target: { value: "visible from notes app" },
  });

  await waitFor(() => {
    expect(
      listExplorerNoteItems(explorer).some(
        (button) => button.textContent?.trim() === "visible from notes app",
      ),
    ).toBe(true);
  });

  const notesWindow = await openNotes(view);

  await waitFor(() => {
    expect(
      within(notesWindow).getByRole("button", {
        name: "visible from notes app",
      }),
    ).toBeTruthy();
    const notesEditor = within(notesWindow).getByRole("textbox", {
      name: /Notes editor/,
    });
    invariant(
      notesEditor instanceof HTMLTextAreaElement,
      "notes app editor not found",
    );
    expect(notesEditor.value).toBe("visible from notes app");
  });

  view.unmount();
});

test("notes app exposes note creation from the file menu", async () => {
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);

  const notesWindow = await openNotes(view);

  expect(
    within(notesWindow).queryByRole("button", { name: "New Note" }),
  ).toBeNull();

  fireEvent.click(within(notesWindow).getByText("File"));
  const newNoteItem = await within(notesWindow).findByRole("menuitem", {
    name: "New Note",
  });
  fireEvent.click(newNoteItem);

  const editor = await within(notesWindow).findByRole("textbox", {
    name: /Notes editor/,
  });
  invariant(editor instanceof HTMLTextAreaElement, "notes editor not found");

  fireEvent.change(editor, {
    target: { value: "file menu note" },
  });

  await waitFor(() => {
    expect(editor.value).toBe("file menu note");
    expect(
      within(notesWindow).getByRole("button", {
        name: "file menu note",
      }),
    ).toBeTruthy();
  });

  view.unmount();
});

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

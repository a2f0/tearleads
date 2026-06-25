import { expect } from "bun:test";
import {
  createMemoryBlobStore,
  type LocalKeyring,
} from "@tearleads/client-sdk";
import {
  type CreateSQLiteRuntimeOptions,
  createSQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";
import {
  act,
  cleanup,
  fireEvent,
  type RenderResult,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "../../src/components/pane/DualPaneProvider";
import { Pane } from "../../src/components/pane/Pane";
import { PaneProvider } from "../../src/components/pane/PaneProvider";
import { AppHostConfig } from "../../src/host/AppHostConfig";
import {
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "../../src/mini-apps/system-monitor/systemMonitorMode";
import {
  AppTestRuntimeScopeProbe,
  waitForAppTestRuntimeToSettle,
} from "./appRuntimeIdle";
import { MockWorker } from "./mockWorker";
import { listProxiedApiRequests, resetMockServer, wsUrl } from "./mswServer";
import { createSharedMemoryLocalKeyringFactory } from "./sharedMemoryLocalKeyring";

export { createSharedMemoryLocalKeyringFactory } from "./sharedMemoryLocalKeyring";

export const PANE_ASYNC_TEST_TIMEOUT_MS = 15_000;
export const PANE_LONG_ASYNC_TEST_TIMEOUT_MS = 30_000;

export async function cleanupPaneTestEnvironment(): Promise<void> {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
}

export function createTestHostConfig(
  options: {
    readonly createLocalKeyring?: (() => LocalKeyring) | null | undefined;
    readonly localIdentityNamespace?: string | undefined;
    readonly workerConstructor?: CreateSQLiteRuntimeOptions["workerConstructor"];
  } = {},
) {
  const createLocalKeyring =
    options.createLocalKeyring === null
      ? undefined
      : (options.createLocalKeyring ?? createSharedMemoryLocalKeyringFactory());

  return new AppHostConfig(
    "http://localhost:3001",
    wsUrl,
    () =>
      createSQLiteRuntime({
        workerConstructor: options.workerConstructor ?? MockWorker,
      }),
    () => createMemoryBlobStore(),
    options.localIdentityNamespace,
    createLocalKeyring,
    options.localIdentityNamespace === undefined,
  );
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function closestHtmlDivElement(
  element: Element | null | undefined,
  selector: string,
): HTMLDivElement | null {
  const closestElement = element?.closest(selector);
  return closestElement instanceof HTMLDivElement ? closestElement : null;
}

export function createDelayedLoadLocalKeyringFactory(
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

export function renderPane({
  hostConfig = createTestHostConfig(),
  // Default the System Monitor to pinned so its status + log render inline, as
  // the home pane always did before the monitor was extracted. Most pane tests
  // (and helpers like generateIdentityAndWaitForDb) assert on that inline
  // status; the windowed launcher/pin behaviour is covered explicitly by
  // SystemMonitor.test.tsx, which opts out with pinSystemMonitor: false.
  pinSystemMonitor = true,
}: {
  readonly hostConfig?: AppHostConfig | undefined;
  readonly pinSystemMonitor?: boolean | undefined;
} = {}): RenderResult {
  // renderPane mounts the left pane; seed localStorage with the matching mode
  // before render. cleanupPaneTestEnvironment() clears it after each test.
  saveSystemMonitorMode(
    systemMonitorModeStorageKey("left"),
    pinSystemMonitor ? "pinned" : "windowed",
  );
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

export async function openExplorer(view: ReturnType<typeof renderPane>) {
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

export async function openExplorerNewStructuredDocumentRoute(
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

export async function openNotes(view: ReturnType<typeof renderPane>) {
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
        "textarea.note-document-editor",
      ),
    ).toBeTruthy();
  });

  return readyNotesWindow;
}

export async function openContacts(view: ReturnType<typeof renderPane>) {
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
    contactsWindow = closestHtmlDivElement(contactsApp, ".window");
    expect(contactsWindow).toBeTruthy();
  });

  invariant(contactsWindow, "contacts window not found");
  return contactsWindow;
}

export function listExplorerNoteItems(
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

export function getExplorerContainerItem(
  explorerWindow: HTMLElement,
  name: string,
): HTMLButtonElement {
  const item = listExplorerContainerItems(explorerWindow).find(
    (button) => button.textContent?.trim() === name,
  );
  invariant(item, `Expected explorer container item "${name}".`);
  return item;
}

export async function createExplorerChildContainer(
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

export async function moveExplorerContainer(
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
  // Explorer hides container ids in user-facing move labels; tests should
  // exercise the same visible folder name a user selects from the dropdown.
  const destinationOptions = Array.from(destinationSelect.options).filter(
    (option) => option.textContent?.trim() === destinationName,
  );
  invariant(
    destinationOptions.length <= 1,
    `Expected one destination option for "${destinationName}", found ${destinationOptions.length}.`,
  );
  const destinationOption = destinationOptions[0];
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

export function getSelectedExplorerContainerSyncLabel(
  explorerWindow: HTMLElement,
): string | null {
  const badge = explorerWindow.querySelector<HTMLElement>(
    ".explorer-detail-title-row .explorer-sync-badge",
  );
  return badge?.getAttribute("aria-label") ?? null;
}

export function summarizeProxiedApiRequests(): string {
  return listProxiedApiRequests()
    .map((request) => {
      const path = new URL(request.url).pathname;
      const response = (() => {
        try {
          const parsed: unknown = JSON.parse(request.responseBody);
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

export async function waitForPaneRuntimeToSettle(
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
const LOCAL_IDENTITY_PACKAGE_STORAGE_PREFIX =
  "tearleads.local-identity-key-package:";

function paneLocalIdentityStorageKey(namespace: string): string {
  return `${LOCAL_IDENTITY_PACKAGE_STORAGE_PREFIX}${namespace}.left`;
}

export async function waitForPersistedPaneLocalIdentity(
  namespace: string,
): Promise<void> {
  await waitFor(
    () => {
      expect(
        globalThis.localStorage.getItem(paneLocalIdentityStorageKey(namespace)),
      ).not.toBeNull();
    },
    { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
  );
}

export function getPaneStatusText(view: ReturnType<typeof renderPane>): string {
  const paneContent =
    view.container.querySelector(".pane-content") ??
    view.baseElement.querySelector(".pane-content");
  return paneContent?.textContent ?? "";
}

export function getPanePublicKey(view: ReturnType<typeof renderPane>): string {
  const statusText = getPaneStatusText(view);
  const match = publicKeyStatusPattern.exec(statusText);
  invariant(match?.[1], "Expected pane public key.");
  return match[1];
}

export async function generateIdentityAndWaitForDb(
  view: ReturnType<typeof renderPane>,
) {
  await act(async () => {
    fireEvent.click(view.getByText("Menu"));
  });
  await act(async () => {
    fireEvent.click(view.getByText("Generate Key Pair"));
  });

  await waitFor(
    () => {
      const statusText = getPaneStatusText(view);
      expect(statusText).toMatch(/sqlite worker:\s*ready/);
      expect(statusText).toMatch(publicKeyStatusPattern);
    },
    { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
  );
  await waitFor(
    () => {
      expect(
        view.queryAllByText(/Root container (created|loaded)/).length,
      ).toBeGreaterThan(0);
    },
    { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
  );
}

export async function registerAndWaitForUserId(
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
      const statusText = getPaneStatusText(view);
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

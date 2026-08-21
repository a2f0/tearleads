import { expect } from "bun:test";
import type { LocalKeyring } from "@symcrypt/client-sdk";
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
} from "../../src/components/pane/dual-pane";
import { PaneProvider } from "../../src/components/pane/runtime/PaneProvider";
import { Pane } from "../../src/components/pane/shell/Pane";
import type { AppHostConfig } from "../../src/host/AppHostConfig";
import { SystemMonitorDeveloperModeProvider } from "../../src/mini-apps/system-monitor/systemMonitorDeveloperMode";
import {
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "../../src/mini-apps/system-monitor/systemMonitorMode";
import {
  AppTestRuntimeScopeProbe,
  waitForAppTestRuntimeToSettle,
} from "./appRuntimeIdle";
import { listProxiedApiRequests, resetMockServer } from "./mswServer";
import { createTestHostConfig } from "./paneTestHostConfig";

export { createSharedMemoryLocalKeyringFactory } from "./sharedMemoryLocalKeyring";
export { createTestHostConfig };
export const PANE_ASYNC_TEST_TIMEOUT_MS = 15_000;
export const PANE_LONG_ASYNC_TEST_TIMEOUT_MS = 30_000;
export async function cleanupPaneTestEnvironment(): Promise<void> {
  cleanup();
  // cleanup() unmounts the tree, which queues SymCryptProvider's deferred
  // dispose (a macrotask, so StrictMode remounts can cancel it). Flush that
  // macrotask here so the sync coordinator pump is force-stopped and dropped
  // before the next test — no spinning pump can bleed across tests.
  await new Promise((resolve) => setTimeout(resolve, 0));
  globalThis.localStorage.clear();
  await resetMockServer();
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
        close: () => keyring.close?.(),
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
  pinSystemMonitor = true,
}: {
  readonly hostConfig?: AppHostConfig | undefined;
  readonly pinSystemMonitor?: boolean | undefined;
} = {}): RenderResult {
  saveSystemMonitorMode(
    systemMonitorModeStorageKey("left"),
    pinSystemMonitor ? "pinned" : "windowed",
  );
  // Mirrors production composition: Layout mounts the developer-mode provider
  // above every Pane.
  return render(
    <SystemMonitorDeveloperModeProvider>
      <DualPaneProvider>
        <PaneSideProvider side="left">
          <PaneProvider hostConfig={hostConfig}>
            <AppTestRuntimeScopeProbe />
            <Pane className="pane" />
          </PaneProvider>
        </PaneSideProvider>
      </DualPaneProvider>
    </SystemMonitorDeveloperModeProvider>,
  );
}
// Clicks a mini-app launcher entry inside the open pane context menu. Scoped to
// the menu so the query does not collide with same-named buttons elsewhere in
// the pane (e.g. an Explorer window listing a "Contacts" system container).
export function clickPaneAppMenuItem(
  view: ReturnType<typeof renderPane>,
  name: string,
) {
  const menu = view.baseElement.querySelector<HTMLElement>(".menu");
  invariant(menu, "pane context menu not found");
  fireEvent.click(within(menu).getByRole("button", { name }));
}

export async function openExplorer(view: ReturnType<typeof renderPane>) {
  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 120,
    clientY: 120,
  });
  clickPaneAppMenuItem(view, "Explorer");

  let explorerWindow: HTMLDivElement | null = null;
  await waitFor(() => {
    const windows =
      view.container.querySelectorAll<HTMLDivElement>("div.window");
    explorerWindow = windows[windows.length - 1] ?? null;
    expect(explorerWindow).toBeTruthy();
  });

  invariant(explorerWindow, "explorer window not found");

  await waitFor(() => {
    expect(
      within(explorerWindow as HTMLDivElement).getByRole("table", {
        name: "Items in /",
      }),
    ).toBeTruthy();
  });

  return explorerWindow as HTMLDivElement;
}

export async function openExplorerNewStructuredDocumentRoute(
  explorerWindow: HTMLElement,
) {
  fireEvent.click(within(explorerWindow).getByText("File"));

  const newStructuredDocumentItem = await within(explorerWindow).findByRole(
    "menuitem",
    {
      name: "New Document",
    },
  );
  fireEvent.click(newStructuredDocumentItem);

  await waitFor(() => {
    expect(
      within(explorerWindow).getByRole("button", { name: "Note" }),
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
  clickPaneAppMenuItem(view, "Notes");

  let notesWindow: HTMLDivElement | null = null;
  await waitFor(() => {
    const windows =
      view.container.querySelectorAll<HTMLDivElement>("div.window");
    expect(windows.length).toBeGreaterThan(existingWindowCount);
    notesWindow = windows[windows.length - 1] ?? null;
    expect(notesWindow).toBeTruthy();
  });

  invariant(notesWindow, "notes window not found");

  await waitFor(() => {
    expect(
      (notesWindow as HTMLDivElement).querySelector<HTMLTextAreaElement>(
        "textarea.note-document-editor",
      ),
    ).toBeTruthy();
  });

  return notesWindow as HTMLDivElement;
}

export async function openContacts(view: ReturnType<typeof renderPane>) {
  const existingWindowCount =
    view.container.querySelectorAll<HTMLDivElement>("div.window").length;

  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 120,
    clientY: 120,
  });
  clickPaneAppMenuItem(view, "Contacts");

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
  // Scope to the context menu: the Explorer toolbar now carries a same-named
  // "Create Child Folder" button whenever a container is active.
  const createChildMenu = view.baseElement.querySelector<HTMLElement>(".menu");
  invariant(createChildMenu, "explorer context menu not found");
  fireEvent.click(
    within(createChildMenu).getByRole("button", {
      name: "Create Child Folder",
    }),
  );

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
  // Scope to the context menu so a document toolbar action cannot shadow it.
  const moveMenu = view.baseElement.querySelector<HTMLElement>(".menu");
  invariant(moveMenu, "explorer context menu not found");
  fireEvent.click(within(moveMenu).getByRole("button", { name: "Move" }));

  const dialog = await view.findByRole("dialog");
  const destinationSelect = within(dialog).getByRole("combobox", {
    name: "Destination container",
  });
  invariant(
    destinationSelect instanceof HTMLButtonElement,
    "Expected destination container dropdown.",
  );

  fireEvent.click(destinationSelect);
  const destinationOption = await within(dialog).findByRole("option", {
    name: destinationName,
  });
  fireEvent.click(destinationOption);
  await waitFor(() => {
    expect(destinationSelect.textContent).toContain(destinationName);
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));

  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull(), {
    timeout: PANE_ASYNC_TEST_TIMEOUT_MS,
  });
}

export function getSelectedExplorerContainerSyncLabel(
  explorerWindow: HTMLElement,
): string | null {
  // Descendant, not direct child: the badge shares the header's trailing
  // controls group with the folder's kebab. Nothing else inside a detail
  // header carries this class, so the reach stays unambiguous.
  const badge = explorerWindow.querySelector<HTMLElement>(
    ".explorer-detail .mini-app-header .explorer-sync-badge",
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
        } catch {}
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

const publicKeyStatusPattern = /publicKey:\s*([0-9a-f]+)/u;

export { waitForPersistedPaneLocalIdentity } from "./localIdentityPersistenceTestUtils";

const STATUS_LABEL_KEYS: Record<string, string> = {
  Events: "events",
  ID: "id",
  Network: "network",
  "Peer User ID": "peerUserId",
  "Public Key": "publicKey",
  "SQLite Worker": "sqlite worker",
  Session: "session",
  "User ID": "userId",
  "Web Socket": "webSocket",
};

function getStatusLabelKey(label: string): string {
  return STATUS_LABEL_KEYS[label] ?? label;
}

// Flatten the rendered status table back to stable assertion keys.
export function flattenPaneStatusText(paneContent: Element): string {
  const rows = paneContent.querySelectorAll(".mini-app-info-table tr");
  if (rows.length === 0) {
    return paneContent.textContent ?? "";
  }
  return Array.from(rows)
    .map((row) => {
      const label = row.querySelector("th")?.textContent?.trim() ?? "";
      const value = row.querySelector("td")?.textContent?.trim() ?? "";
      return `${getStatusLabelKey(label)}: ${value}`;
    })
    .join("\n");
}

export function getPaneStatusText(view: ReturnType<typeof renderPane>): string {
  const paneContent =
    view.container.querySelector(".pane-content") ??
    view.baseElement.querySelector(".pane-content");
  return paneContent ? flattenPaneStatusText(paneContent) : "";
}

export function getAllPaneStatusTexts(
  view: ReturnType<typeof renderPane>,
): string[] {
  return Array.from(view.baseElement.querySelectorAll(".pane-content")).map(
    flattenPaneStatusText,
  );
}

export function getPanePublicKey(view: ReturnType<typeof renderPane>): string {
  const match = publicKeyStatusPattern.exec(getPaneStatusText(view));
  invariant(match?.[1], "Expected pane public key.");
  return match[1];
}

export async function generateIdentityAndWaitForDb(
  view: ReturnType<typeof renderPane>,
) {
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Menu" }));
  });
  await act(async () => {
    const menu = view.baseElement.querySelector<HTMLElement>(".menu");
    invariant(menu, "pane menu not found");
    fireEvent.click(
      within(menu).getByRole("button", { name: "Generate Key Pair" }),
    );
  });

  await waitFor(
    () => {
      const statusText = getPaneStatusText(view);
      expect(statusText).toMatch(/(?:sqlite worker|SQLite Worker):\s*ready/);
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

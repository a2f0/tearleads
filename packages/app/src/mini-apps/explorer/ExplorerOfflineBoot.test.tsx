import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { FailingInitMockWorker } from "../../../test/helpers/mockWorker";
import { useTestApiAppHandlers } from "../../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  createSharedMemoryLocalKeyringFactory,
  createTestHostConfig,
  generateIdentityAndWaitForDb,
  getPaneStatusText,
  openExplorer,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
  waitForPersistedPaneLocalIdentity,
} from "../../../test/helpers/paneTestUtils";

const OFFLINE_NAMESPACE = "explorer-offline-boot";

afterEach(async () => {
  await cleanupPaneTestEnvironment();
});

function openExplorerWindow(
  view: ReturnType<typeof renderPane>,
): HTMLDivElement {
  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 120,
    clientY: 120,
  });
  fireEvent.click(view.getByText("Open Explorer"));

  const windows = view.container.querySelectorAll<HTMLDivElement>("div.window");
  const explorerWindow = windows[windows.length - 1] ?? null;
  if (!explorerWindow) {
    throw new Error("explorer window not found");
  }

  return explorerWindow;
}

// Reproduces the offline failure mode: on a reload with no network, the local
// identity restores from storage (which needs no network), but the SQLite worker
// cannot boot because the separately-fetched `sqlite3.wasm` asset is unavailable
// and there is no service worker to serve it from cache. Explorer is then stuck
// on "Loading..." forever, and the boot error is never surfaced.
//
// This documents the current (buggy) behavior. Explorer's loading gate is a
// single boolean (`ready`) tied to `dbStatus === "ready"` with no error branch
// (ExplorerDetailPanel `ExplorerEmptyDetail`), so a definitive boot failure is
// rendered identically to "still loading". A correct device-first/offline gate
// would surface the error (with a retry) instead of an infinite spinner.
test(
  "explorer is stuck on 'Loading...' offline when the identity restores but the SQLite worker fails to boot",
  async () => {
    useTestApiAppHandlers();
    // One shared keyring instance so the persisted identity from phase 1 can be
    // decrypted when it is restored in phase 2.
    const createLocalKeyring = createSharedMemoryLocalKeyringFactory();

    // Phase 1 — a healthy online session that persists a local identity.
    const online = renderPane({
      hostConfig: createTestHostConfig({
        createLocalKeyring,
        localIdentityNamespace: OFFLINE_NAMESPACE,
      }),
    });
    await generateIdentityAndWaitForDb(online);
    await waitForPersistedPaneLocalIdentity(OFFLINE_NAMESPACE);
    online.unmount();

    // Phase 2 — simulate an offline reload: same identity storage + keyring, but
    // the SQLite worker cannot boot.
    const offline = renderPane({
      hostConfig: createTestHostConfig({
        createLocalKeyring,
        localIdentityNamespace: OFFLINE_NAMESPACE,
        workerConstructor: FailingInitMockWorker,
      }),
    });

    // The identity restores from storage with no network, but the DB boot fails.
    await waitFor(
      () => {
        const status = getPaneStatusText(offline);
        expect(status).toMatch(/publicKey:\s*[0-9a-f]/);
        expect(status).toMatch(/sqlite worker:\s*error/);
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );

    const explorerWindow = openExplorerWindow(offline);

    // The Explorer window renders, but its content is stuck on "Loading...".
    await waitFor(() => {
      expect(explorerWindow.textContent).toContain("Loading...");
    });

    // It never resolves to the ready-but-empty state ("No containers.") and never
    // surfaces the boot error — the database status is "error" the whole time.
    expect(getPaneStatusText(offline)).toMatch(/sqlite worker:\s*error/);
    expect(explorerWindow.textContent).toContain("Loading...");
    expect(explorerWindow.textContent).not.toContain("No containers.");

    offline.unmount();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

// Control: the same offline reload, but with a SQLite worker that boots. The only
// difference from the test above is whether the database reaches "ready", and
// here Explorer renders normally (its "Items in /" tree appears). This isolates
// the offline hang to the database boot — not the lack of network, not identity
// restore, and not the device-first read/sync path.
test(
  "explorer renders offline (not stuck) when the identity restores and the SQLite worker boots",
  async () => {
    useTestApiAppHandlers();
    const createLocalKeyring = createSharedMemoryLocalKeyringFactory();

    const online = renderPane({
      hostConfig: createTestHostConfig({
        createLocalKeyring,
        localIdentityNamespace: OFFLINE_NAMESPACE,
      }),
    });
    await generateIdentityAndWaitForDb(online);
    await waitForPersistedPaneLocalIdentity(OFFLINE_NAMESPACE);
    online.unmount();

    // Same restore path, but the worker boots (no network is required to reach a
    // ready local database).
    const offline = renderPane({
      hostConfig: createTestHostConfig({
        createLocalKeyring,
        localIdentityNamespace: OFFLINE_NAMESPACE,
      }),
    });
    await waitFor(
      () => {
        expect(getPaneStatusText(offline)).toMatch(/sqlite worker:\s*ready/);
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );

    // openExplorer waits for the rendered "Items in /" tree, so reaching this
    // point already proves Explorer is not stuck on the top-level loading gate.
    const explorerWindow = await openExplorer(offline);
    expect(
      within(explorerWindow).getByRole("table", { name: "Items in /" }),
    ).toBeTruthy();

    offline.unmount();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

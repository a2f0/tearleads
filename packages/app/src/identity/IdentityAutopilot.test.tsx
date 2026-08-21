import { afterEach, expect, test } from "bun:test";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { AppTestRuntimeScopeProbe } from "../../test/helpers/appRuntimeIdle";
import { openIdentityManagerFromPane } from "../../test/helpers/identityPaneTestUtils";
import { useTestApiAppHandlers } from "../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  createSharedMemoryLocalKeyringFactory,
  createTestHostConfig,
  getExplorerContainerItem,
  getPanePublicKey,
  getPaneStatusText,
  openContacts,
  openExplorer,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
  waitForPaneRuntimeToSettle,
  waitForPersistedPaneLocalIdentity,
} from "../../test/helpers/paneTestUtils";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "../components/pane/dual-pane";
import { PaneProvider } from "../components/pane/runtime/PaneProvider";
import { Pane } from "../components/pane/shell/Pane";
import { DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE } from "../components/shared/DestroyKeyPackageConfirmationDialog";
import type { AppHostConfig } from "../host/AppHostConfig";
import { SystemMonitorDeveloperModeProvider } from "../mini-apps/system-monitor/systemMonitorDeveloperMode";
import {
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "../mini-apps/system-monitor/systemMonitorMode";

afterEach(cleanupPaneTestEnvironment);

const LOCAL_CRYPTO_SESSION_STORAGE_PREFIX = "symcrypt.local-session:";
const USER_ID_STATUS_PATTERN =
  /userId:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/u;

// A left-pane runtime like renderPane's, but with control over the autopilot's
// `enabled` prop so the active-workspace gate can be exercised.
function renderAutopilotPane(options: {
  readonly autoProvisionEnabled?: boolean | undefined;
  readonly hostConfig: AppHostConfig;
}) {
  saveSystemMonitorMode(systemMonitorModeStorageKey("left"), "pinned");
  // Mirrors production composition: Layout mounts the developer-mode provider
  // above every Pane.
  return render(
    <SystemMonitorDeveloperModeProvider>
      <DualPaneProvider>
        <PaneSideProvider side="left">
          <PaneProvider
            autoProvisionEnabled={options.autoProvisionEnabled}
            hostConfig={options.hostConfig}
          >
            <AppTestRuntimeScopeProbe />
            <Pane className="pane" />
          </PaneProvider>
        </PaneSideProvider>
      </DualPaneProvider>
    </SystemMonitorDeveloperModeProvider>,
  );
}

function getPaneUserId(view: ReturnType<typeof renderPane>): string {
  const match = USER_ID_STATUS_PATTERN.exec(getPaneStatusText(view));
  if (!match?.[1]) {
    throw new Error("Expected a registered pane user id.");
  }
  return match[1];
}

async function waitForRegisteredSession(
  view: ReturnType<typeof renderPane>,
): Promise<void> {
  await waitFor(
    () => {
      const statusText = getPaneStatusText(view);
      expect(statusText).not.toMatch(/userId:\s*none/);
      expect(statusText).not.toMatch(/session:\s*none/);
    },
    { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
  );
}

async function waitForPersistedPaneCryptoSession(
  namespace: string,
): Promise<void> {
  const prefix = `${LOCAL_CRYPTO_SESSION_STORAGE_PREFIX}${namespace}.left:`;
  await waitFor(
    () => {
      expect(
        Array.from({ length: globalThis.localStorage.length }, (_, index) =>
          globalThis.localStorage.key(index),
        ).some((key) => key?.startsWith(prefix)),
      ).toBe(true);
    },
    { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
  );
}

test(
  "autopilot generates a key pair and registers without manual actions",
  async () => {
    const view = renderPane({
      hostConfig: createTestHostConfig({ autoProvisionIdentity: true }),
    });

    // No clicks: the autopilot derives the key pair and boots the database.
    await waitFor(
      () => {
        const statusText = getPaneStatusText(view);
        expect(statusText).toMatch(/sqlite worker:\s*ready/);
        expect(statusText).toMatch(/publicKey:\s*[0-9a-f]{64}/u);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );

    // ...then registers and logs in, so a user id and live session appear.
    await waitForRegisteredSession(view);

    // Drain registration's follow-on sync before teardown destroys the worker.
    await waitForPaneRuntimeToSettle(PANE_ASYNC_TEST_TIMEOUT_MS);
    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);

test(
  "autopilot bootstraps system containers before mini-app launch",
  async () => {
    // Runs against the real API app (not the minimal in-memory stubs) because
    // the two system folders now reach the tree by different routes that both
    // need a faithful server: Contacts is created device-first and promoted to
    // remote sync, while Trash is born with the organization — provisioned
    // server-side in the same transaction as the org registration and pulled
    // back in by SystemBootstrapProvider's root-lane poll. The stub register
    // handler neither provisions nor lists the eager Trash, so only a real
    // backend exercises the autopilot's bootstrap-gates-registration ordering
    // end to end.
    useTestApiAppHandlers();
    const view = renderPane({
      hostConfig: createTestHostConfig({ autoProvisionIdentity: true }),
    });

    // Registration is gated on system bootstrap completing (IdentityAutopilot
    // only registers once ensureBootstrapped() resolves completed), so a
    // registered session is itself evidence that bootstrap ran first — the
    // system containers and self contact asserted below already existed before
    // any mini-app was opened.
    await waitForRegisteredSession(view);
    await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);

    // Contacts arrives via device-first create + promotion; Trash arrives via
    // the eager server-side provision + root-lane poll. Both are present before
    // any mini-app opens.
    const explorer = await openExplorer(view);
    await waitFor(
      () => {
        expect(getExplorerContainerItem(explorer, "Contacts")).toBeTruthy();
        expect(getExplorerContainerItem(explorer, "Trash")).toBeTruthy();
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );

    const contactsWindow = await openContacts(view);
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
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);

test(
  "autopilot restores a persisted identity and does not re-register on reload",
  async () => {
    const localIdentityNamespace = `test-autopilot-reload-${crypto.randomUUID()}`;
    const hostConfig = createTestHostConfig({
      autoProvisionIdentity: true,
      createLocalKeyring: createSharedMemoryLocalKeyringFactory(),
      localIdentityNamespace,
    });

    const view = renderPane({ hostConfig });
    await waitFor(
      () => {
        expect(getPaneStatusText(view)).toMatch(/publicKey:\s*[0-9a-f]{64}/u);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    const persistedPublicKey = getPanePublicKey(view);
    await waitForRegisteredSession(view);
    const firstUserId = getPaneUserId(view);
    await waitForPersistedPaneLocalIdentity(localIdentityNamespace);
    await waitForPersistedPaneCryptoSession(localIdentityNamespace);
    await waitForPaneRuntimeToSettle(PANE_ASYNC_TEST_TIMEOUT_MS);
    view.unmount();

    // On reload the autopilot must wait for the restore to settle and adopt the
    // persisted identity rather than clobbering it with a freshly generated key;
    // the restored session means it must NOT register a second time. The mock
    // register endpoint mints a fresh userId per call, so an identical userId
    // proves the session was restored rather than re-registered.
    const reloadedView = renderPane({ hostConfig });
    await waitFor(
      () => {
        const statusText = getPaneStatusText(reloadedView);
        expect(statusText).toMatch(/sqlite worker:\s*ready/);
        expect(statusText).toContain(`publicKey: ${persistedPublicKey}`);
        expect(statusText).not.toMatch(/userId:\s*none/);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );

    await waitForPaneRuntimeToSettle(PANE_ASYNC_TEST_TIMEOUT_MS);
    expect(getPaneUserId(reloadedView)).toBe(firstUserId);
    reloadedView.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);

test("autopilot stays idle when the profile opts out", async () => {
  const view = renderPane({ hostConfig: createTestHostConfig() });

  await waitForPaneRuntimeToSettle();

  const statusText = getPaneStatusText(view);
  expect(statusText).toMatch(/sqlite worker:\s*idle/);
  expect(statusText).not.toMatch(/publicKey:\s*[0-9a-f]{64}/u);
  expect(
    view.getByText(
      /Generate a key pair from the pane menu to boot this pane\./,
    ),
  ).toBeTruthy();

  view.unmount();
});

test(
  "autopilot does not re-provision after an explicit destroy",
  async () => {
    const view = renderPane({
      hostConfig: createTestHostConfig({ autoProvisionIdentity: true }),
    });

    // Let the autopilot provision an identity first.
    await waitFor(
      () => {
        expect(getPaneStatusText(view)).toMatch(/publicKey:\s*[0-9a-f]{64}/u);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    await waitForRegisteredSession(view);
    await waitForPaneRuntimeToSettle(PANE_ASYNC_TEST_TIMEOUT_MS);

    // Explicitly destroy the key pair via Identity Manager + confirmation.
    const identityManagerWindow = await openIdentityManagerFromPane(view);
    fireEvent.click(
      within(identityManagerWindow).getByRole("button", {
        name: "Destroy Key Pair",
      }),
    );
    fireEvent.change(view.getByLabelText(/Type confirm delete to continue/u), {
      target: { value: DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE },
    });
    fireEvent.click(view.getByRole("button", { name: "Destroy Key Package" }));

    // "Destroy stays destroyed": the autopilot must not auto-regenerate.
    await waitFor(() => {
      expect(getPaneStatusText(view)).toMatch(/publicKey:\s*none/);
    });
    await waitForPaneRuntimeToSettle();
    expect(getPaneStatusText(view)).toMatch(/publicKey:\s*none/);

    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);

test("autopilot stays idle for an inactive workspace even with the flags on", async () => {
  // The regular app mounts every workspace runtime concurrently; an inactive
  // workspace passes autoProvisionEnabled=false so it must not provision a
  // second identity/org behind the scenes. No key pair means no registration.
  const view = renderAutopilotPane({
    autoProvisionEnabled: false,
    hostConfig: createTestHostConfig({ autoProvisionIdentity: true }),
  });

  await waitForPaneRuntimeToSettle();

  const statusText = getPaneStatusText(view);
  expect(statusText).toMatch(/sqlite worker:\s*idle/);
  expect(statusText).not.toMatch(/publicKey:\s*[0-9a-f]{64}/u);

  view.unmount();
});

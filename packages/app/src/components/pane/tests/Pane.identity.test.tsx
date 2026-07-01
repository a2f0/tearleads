import { afterEach, expect, test } from "bun:test";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import {
  openIdentityManagerFromPane,
  registerAndWaitForUserId,
} from "../../../../test/helpers/identityPaneTestUtils";
import {
  cleanupPaneTestEnvironment,
  clickPaneAppMenuItem,
  createDelayedLoadLocalKeyringFactory,
  createSharedMemoryLocalKeyringFactory,
  createTestHostConfig,
  generateIdentityAndWaitForDb,
  getPanePublicKey,
  getPaneStatusText,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
  waitForPersistedPaneLocalIdentity,
} from "../../../../test/helpers/paneTestUtils";
import { enableSystemMonitorDeveloperMode } from "../../../../test/helpers/systemMonitorTestPreferences";
import { DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE } from "../../shared/DestroyKeyPackageConfirmationDialog";

afterEach(cleanupPaneTestEnvironment);

const LOCAL_CRYPTO_SESSION_STORAGE_PREFIX = "tearleads.local-session:";

function paneLocalCryptoSessionStorageKey(namespace: string): string {
  return `${LOCAL_CRYPTO_SESSION_STORAGE_PREFIX}${namespace}.left`;
}

async function waitForPersistedPaneCryptoSession(
  namespace: string,
): Promise<void> {
  await waitFor(
    () => {
      expect(
        globalThis.localStorage.getItem(
          paneLocalCryptoSessionStorageKey(namespace),
        ),
      ).not.toBeNull();
    },
    { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
  );
}

function rejectAuthVerifyRequests(): {
  readonly getCallCount: () => number;
  readonly restore: () => void;
} {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  const restoreFetch = () => {
    if (globalThis.fetch === rejectAuthVerifyFetch) {
      globalThis.fetch = originalFetch;
    }
  };
  const rejectAuthVerifyFetch = ((
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (
      request.method === "POST" &&
      request.url === "http://localhost:3001/auth/verify"
    ) {
      callCount += 1;
      return Promise.reject(
        new TypeError("auth verify should not run after session restore"),
      );
    }

    return originalFetch(input, init);
  }) as typeof fetch;
  rejectAuthVerifyFetch.preconnect = originalFetch.preconnect;

  globalThis.fetch = rejectAuthVerifyFetch;
  return { getCallCount: () => callCount, restore: restoreFetch };
}

function confirmDestroyKeyPackage(view: ReturnType<typeof renderPane>) {
  fireEvent.change(view.getByLabelText(/Type confirm delete to continue/u), {
    target: { value: DESTROY_KEY_PACKAGE_CONFIRMATION_PHRASE },
  });
  fireEvent.click(view.getByRole("button", { name: "Destroy Key Package" }));
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

  await act(async () => {
    fireEvent.contextMenu(view.getByRole("application"), {
      clientX: 120,
      clientY: 120,
    });
  });

  expect(view.getByText("Generate Key Pair")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Notes" })).toBeNull();

  await act(async () => {
    fireEvent.click(view.getByText("Generate Key Pair"));
  });

  await waitFor(() => {
    const statusText = getPaneStatusText(view);
    expect(statusText).toMatch(/sqlite worker:\s*ready/);
    expect(statusText).toMatch(/publicKey:\s*[0-9a-f]{64}/u);
  });

  view.unmount();
});

test(
  "generated pane key pair rehydrates after remount",
  async () => {
    const localIdentityNamespace = `test-pane-reload-${crypto.randomUUID()}`;
    const hostConfig = createTestHostConfig({
      createLocalKeyring: createSharedMemoryLocalKeyringFactory(),
      localIdentityNamespace,
    });
    const view = renderPane({ hostConfig });

    await generateIdentityAndWaitForDb(view);
    await waitForPersistedPaneLocalIdentity(localIdentityNamespace);
    const persistedPublicKey = getPanePublicKey(view);
    view.unmount();

    const reloadedView = renderPane({ hostConfig });
    await waitFor(
      () => {
        const statusText = getPaneStatusText(reloadedView);
        expect(statusText).toMatch(/sqlite worker:\s*ready/);
        expect(statusText).toContain(`publicKey: ${persistedPublicKey}`);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );

    fireEvent.contextMenu(reloadedView.getByRole("application"), {
      clientX: 120,
      clientY: 120,
    });
    expect(reloadedView.queryByText("Generate Key Pair")).toBeNull();
    expect(reloadedView.queryByText("Open Floating Window")).toBeNull();
    expect(reloadedView.getByRole("button", { name: "Notes" })).toBeTruthy();

    reloadedView.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);

test(
  "registered pane identity restores persisted session after remount",
  async () => {
    const localIdentityNamespace = `test-pane-session-reload-${crypto.randomUUID()}`;
    const hostConfig = createTestHostConfig({
      createLocalKeyring: createSharedMemoryLocalKeyringFactory(),
      localIdentityNamespace,
    });
    const view = renderPane({ hostConfig });

    await generateIdentityAndWaitForDb(view);
    await waitForPersistedPaneLocalIdentity(localIdentityNamespace);
    const userId = await registerAndWaitForUserId(view);
    await waitFor(() => {
      expect(getPaneStatusText(view)).not.toMatch(/session:\s*none/);
    });
    await waitForPersistedPaneCryptoSession(localIdentityNamespace);
    view.unmount();

    const authVerifyGuard = rejectAuthVerifyRequests();
    const reloadedView = renderPane({ hostConfig });
    try {
      await waitFor(
        () => {
          const statusText = getPaneStatusText(reloadedView);
          expect(statusText).toMatch(/sqlite worker:\s*ready/);
          expect(statusText).toContain(`userId: ${userId}`);
          expect(statusText).not.toMatch(/session:\s*none/);
        },
        { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
      );
      expect(authVerifyGuard.getCallCount()).toBe(0);
    } finally {
      authVerifyGuard.restore();
      reloadedView.unmount();
    }
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);

test(
  "local identity restore does not overwrite generate clicks while loading",
  async () => {
    const createSharedLocalKeyring = createSharedMemoryLocalKeyringFactory();
    const localIdentityNamespace = `test-pane-restore-race-${crypto.randomUUID()}`;
    const initialHostConfig = createTestHostConfig({
      createLocalKeyring: createSharedLocalKeyring,
      localIdentityNamespace,
    });
    const view = renderPane({ hostConfig: initialHostConfig });

    await generateIdentityAndWaitForDb(view);
    await waitForPersistedPaneLocalIdentity(localIdentityNamespace);
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
    await act(async () => {
      fireEvent.click(reloadedView.getByText("Menu"));
    });
    await act(async () => {
      fireEvent.click(reloadedView.getByText("Generate Key Pair"));
    });

    await waitFor(
      () => {
        const statusText = getPaneStatusText(reloadedView);
        expect(statusText).toMatch(/sqlite worker:\s*ready/);
        expect(statusText).toMatch(/publicKey:\s*[0-9a-f]{64}/u);
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

    reloadedView.unmount();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "displays userId after registration",
  async () => {
    const view = renderPane();

    expect(getPaneStatusText(view)).toMatch(/userId:\s*none/);

    await generateIdentityAndWaitForDb(view);
    const userId = await registerAndWaitForUserId(view);

    await waitFor(() => {
      expect(getPaneStatusText(view)).toContain(`userId: ${userId}`);
    });

    fireEvent.click(view.getByText("Menu"));
    expect(view.queryByText("Register")).toBeNull();
    expect(view.queryByText("Login")).toBeNull();

    view.unmount();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "logged-in pane menu omits logout while identity manager can log out",
  async () => {
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);
    const userId = await registerAndWaitForUserId(view);

    await waitFor(() => {
      expect(getPaneStatusText(view)).toContain(`userId: ${userId}`);
      expect(getPaneStatusText(view)).not.toMatch(/session:\s*none/);
    });

    fireEvent.click(view.getByText("Menu"));
    expect(view.queryByRole("button", { name: "Logout" })).toBeNull();
    expect(view.queryByRole("button", { name: "Destroy Key Pair" })).toBeNull();
    expect(view.getByRole("button", { name: "Explorer" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Notes" })).toBeTruthy();

    const identityManagerWindow = await openIdentityManagerFromPane(view);
    const identitySection = within(identityManagerWindow)
      .getByRole("heading", { name: "Identity" })
      .closest("section");
    if (!identitySection) {
      throw new Error("Expected Identity Manager identity section.");
    }
    fireEvent.click(
      within(identitySection).getByRole("button", { name: "Log Out" }),
    );

    const dialog = view.getByRole("dialog");
    expect(dialog).toBeTruthy();
    const checkbox = within(dialog).getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.classList.contains("logout-confirmation-checkbox")).toBe(
      true,
    );
    expect(getPaneStatusText(view)).not.toMatch(/session:\s*none/);

    fireEvent.click(within(dialog).getByRole("button", { name: "Log Out" }));

    await waitFor(() => {
      expect(getPaneStatusText(view)).toMatch(/session:\s*none/);
      expect(getPaneStatusText(view)).toContain(`userId: ${userId}`);
    });

    view.unmount();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "identity manager opens from the pane and lists active sessions",
  async () => {
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);
    await registerAndWaitForUserId(view);

    fireEvent.contextMenu(view.getByRole("application"), {
      clientX: 120,
      clientY: 120,
    });
    clickPaneAppMenuItem(view, "Identity Manager");

    await waitFor(() => {
      expect(view.getByText("Identity Manager")).toBeTruthy();
      expect(view.getByText("Active Sessions")).toBeTruthy();
      expect(view.getByText("Current")).toBeTruthy();
      expect(view.getByText("Backup Key Package")).toBeTruthy();
    });
    expect(view.container.querySelector(".window-sidebar-layout")).toBeNull();

    view.unmount();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "userId resets to none when key pair is destroyed",
  async () => {
    enableSystemMonitorDeveloperMode();
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);
    const userId = await registerAndWaitForUserId(view);

    await waitFor(() => {
      expect(getPaneStatusText(view)).toContain(`userId: ${userId}`);
    });

    const identityManagerWindow = await openIdentityManagerFromPane(view);
    fireEvent.click(
      within(identityManagerWindow).getByRole("button", {
        name: "Destroy Key Pair",
      }),
    );
    confirmDestroyKeyPackage(view);

    await waitFor(() => {
      expect(getPaneStatusText(view)).toMatch(/userId:\s*none/);
    });

    view.unmount();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "pane menu can generate a new key pair after destroying the current key pair",
  async () => {
    enableSystemMonitorDeveloperMode();
    const view = renderPane({
      hostConfig: createTestHostConfig({
        localIdentityNamespace: `test-pane-regenerate-${crypto.randomUUID()}`,
      }),
    });

    await generateIdentityAndWaitForDb(view);
    const firstPublicKey = getPanePublicKey(view);
    await registerAndWaitForUserId(view);

    const identityManagerWindow = await openIdentityManagerFromPane(view);
    fireEvent.click(
      within(identityManagerWindow).getByRole("button", {
        name: "Destroy Key Pair",
      }),
    );
    confirmDestroyKeyPackage(view);

    await generateIdentityAndWaitForDb(view);
    const secondPublicKey = getPanePublicKey(view);

    expect(secondPublicKey).not.toBe(firstPublicKey);
    expect(getPaneStatusText(view)).toMatch(/userId:\s*none/);
    expect(view.queryByText(/Failed to generate identity keys/)).toBeNull();

    view.unmount();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

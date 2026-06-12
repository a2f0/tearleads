import { afterEach, expect, test } from "bun:test";
import {
  createLocalStorageLocalKeyringManifestStore,
  LOCAL_KEYRING_MANIFEST_FORMAT,
  type LocalKeyringManifest,
  WRAPPED_LOCAL_SECRET_FORMAT,
} from "@tearleads/client-sdk";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import {
  cleanupPaneTestEnvironment,
  createDelayedLoadLocalKeyringFactory,
  createSharedMemoryLocalKeyringFactory,
  createTestHostConfig,
  generateIdentityAndWaitForDb,
  getPanePublicKey,
  getPaneStatusText,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  registerAndWaitForUserId,
  renderPane,
  waitForPersistedPaneLocalIdentity,
} from "../../../test/helpers/paneTestUtils";
import { pinCodeConfigKey } from "../../providers/local-keyring/localKeyringLockSupport";
import { LOCAL_BLOB_STORE_SCOPE_NAMESPACE } from "../../providers/local-keyring/localKeyringScopes";

afterEach(cleanupPaneTestEnvironment);

const LOCAL_CRYPTO_SESSION_STORAGE_PREFIX = "tearleads.local-session:";
const PIN_CODE_WRAPPING_ALGORITHM = "pin-code-pbkdf2-sha256-aes-256-gcm";
const PIN_CODE_PROVIDER = "pin-code";

function paneLocalCryptoSessionStorageKey(namespace: string): string {
  return `${LOCAL_CRYPTO_SESSION_STORAGE_PREFIX}${namespace}.left`;
}

async function persistLockedBlobStoreManifest(
  namespace: string,
): Promise<void> {
  const now = new Date(0).toISOString();
  const scope: LocalKeyringManifest["scope"] = {
    accountId: null,
    namespace: LOCAL_BLOB_STORE_SCOPE_NAMESPACE,
    signingFingerprint: null,
  };

  await createLocalStorageLocalKeyringManifestStore().saveManifest({
    createdAt: now,
    format: LOCAL_KEYRING_MANIFEST_FORMAT,
    rootKeyEnvelope: {
      algorithm: PIN_CODE_WRAPPING_ALGORITHM,
      ciphertext: "test-ciphertext",
      context: {
        purpose: "account-root",
        scope,
      },
      format: WRAPPED_LOCAL_SECRET_FORMAT,
      iv: "test-iv",
      keyId: "pin-code:test",
      provider: PIN_CODE_PROVIDER,
      version: 1,
      wrappedAt: now,
    },
    scope,
    updatedAt: now,
    version: 1,
  });
  globalThis.localStorage.setItem(pinCodeConfigKey(namespace), "1");
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
  expect(view.queryByText("Open Notes")).toBeNull();

  await act(async () => {
    fireEvent.click(view.getByText("Generate Key Pair"));
  });

  await waitFor(() => {
    const statusText =
      view.container.querySelector(".pane-content")?.textContent ?? "";
    expect(statusText).toMatch(/sqlite worker:\s*ready/);
    expect(statusText).toMatch(/publicKey:\s*[0-9a-f]{64}/u);
  });

  view.unmount();
});

test("locked browser-managed pane menu offers unlock instead of key generation", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const hadIndexedDB = "indexedDB" in globalThis;
  const localIdentityNamespace = `test-pane-pin-lock-${crypto.randomUUID()}`;
  const paneLocalIdentityNamespace = `${localIdentityNamespace}.left`;

  try {
    Reflect.set(globalThis, "indexedDB", originalIndexedDB ?? {});
    await persistLockedBlobStoreManifest(paneLocalIdentityNamespace);

    const view = renderPane({
      hostConfig: createTestHostConfig({
        createLocalKeyring: null,
        localIdentityNamespace,
      }),
    });

    await waitFor(() => {
      expect(
        view.getByText(/Unlock the local keychain to restore this pane\./),
      ).toBeTruthy();
    });

    fireEvent.click(view.getByText("Menu"));

    const unlockDatabaseItem = view.getByRole("button", {
      name: "Unlock Database",
    });
    expect(unlockDatabaseItem).toBeTruthy();
    expect(view.queryByLabelText("PIN code")).toBeNull();
    expect(view.queryByText("Generate Key Pair")).toBeNull();
    expect(view.getByText("Restore Key Package")).toBeTruthy();

    fireEvent.click(unlockDatabaseItem);

    let unlockWindow: HTMLDivElement | null = null;
    await waitFor(() => {
      const unlockHeading = view.getByText("Local keychain locked");
      unlockWindow = unlockHeading.closest(".window");
      expect(unlockWindow).toBeTruthy();
    });
    if (!unlockWindow) {
      throw new Error("Expected unlock window.");
    }
    expect(within(unlockWindow).getByLabelText("PIN code")).toBeTruthy();

    fireEvent.contextMenu(view.getByRole("application"), {
      clientX: 120,
      clientY: 120,
    });
    fireEvent.click(view.getByText("Open Contacts"));

    await waitFor(() => {
      expect(view.getAllByText("Local keychain locked").length).toBeGreaterThan(
        1,
      );
    });
    expect(view.container.querySelector(".window-sidebar-layout")).toBeNull();

    view.unmount();
  } finally {
    if (hadIndexedDB) {
      Reflect.set(globalThis, "indexedDB", originalIndexedDB);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  }
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
    expect(reloadedView.getByText("Open Notes")).toBeTruthy();

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
      expect(view.queryByText(/session: none/)).toBeNull();
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
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "logged-in pane menu can log out",
  async () => {
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
    fireEvent.click(view.getByText("Open Identity Manager"));

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
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

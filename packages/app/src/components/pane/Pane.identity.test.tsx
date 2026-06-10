import { afterEach, expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
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

afterEach(cleanupPaneTestEnvironment);

function failNextAuthVerify(): () => void {
  const originalFetch = globalThis.fetch;
  let shouldFail = true;
  const restoreFetch = () => {
    if (globalThis.fetch === failVerifyOnceFetch) {
      globalThis.fetch = originalFetch;
    }
  };
  const failVerifyOnceFetch = ((
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (
      shouldFail &&
      request.method === "POST" &&
      request.url === "http://localhost:3001/auth/verify"
    ) {
      shouldFail = false;
      restoreFetch();
      return Promise.reject(new TypeError("transient test auth failure"));
    }

    return originalFetch(input, init);
  }) as typeof fetch;
  failVerifyOnceFetch.preconnect = originalFetch.preconnect;

  globalThis.fetch = failVerifyOnceFetch;
  return restoreFetch;
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
  "registered pane identity reauthenticates after remount",
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
    view.unmount();

    const reloadedView = renderPane({ hostConfig });
    await waitFor(
      () => {
        const statusText = getPaneStatusText(reloadedView);
        expect(statusText).toMatch(/sqlite worker:\s*ready/);
        expect(statusText).toContain(`userId: ${userId}`);
        expect(statusText).not.toMatch(/session:\s*none/);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );

    reloadedView.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);

test(
  "registered pane identity retries restored login after a transient auth request failure",
  async () => {
    const localIdentityNamespace = `test-pane-session-retry-${crypto.randomUUID()}`;
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
    view.unmount();

    const restoreFetch = failNextAuthVerify();
    const reloadedView = renderPane({ hostConfig });
    try {
      await waitFor(
        () => {
          const statusText = getPaneStatusText(reloadedView);
          expect(statusText).toContain(`userId: ${userId}`);
          expect(statusText).not.toMatch(/session:\s*none/);
        },
        { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
      );
    } finally {
      restoreFetch();
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

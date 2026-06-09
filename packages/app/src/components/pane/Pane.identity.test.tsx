import { afterEach, expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import {
  cleanupPaneTestEnvironment,
  createDelayedLoadLocalKeyringFactory,
  createSharedMemoryLocalKeyringFactory,
  createTestHostConfig,
  generateIdentityAndWaitForDb,
  getPanePublicKey,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  registerAndWaitForUserId,
  renderPane,
} from "../../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment);

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

test("registered pane identity reauthenticates after remount", async () => {
  const hostConfig = createTestHostConfig({
    createLocalKeyring: createSharedMemoryLocalKeyringFactory(),
    localIdentityNamespace: `test-pane-session-reload-${crypto.randomUUID()}`,
  });
  const view = renderPane({ hostConfig });

  await generateIdentityAndWaitForDb(view);
  const userId = await registerAndWaitForUserId(view);
  await waitFor(() => {
    expect(view.queryByText(/session: none/)).toBeNull();
  });
  view.unmount();

  const reloadedView = renderPane({ hostConfig });
  await waitFor(
    () => {
      expect(reloadedView.getByText(/sqlite worker: ready/)).toBeTruthy();
      expect(
        reloadedView.getByText(new RegExp(`userId: ${userId}`)),
      ).toBeTruthy();
      expect(reloadedView.queryByText(/session: none/)).toBeNull();
      expect(
        reloadedView.getByText(/Local identity key package restored/),
      ).toBeTruthy();
      expect(reloadedView.getByText(/Authentication successful/)).toBeTruthy();
    },
    { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
  );

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
  await act(async () => {
    fireEvent.click(reloadedView.getByText("Menu"));
  });
  await act(async () => {
    fireEvent.click(reloadedView.getByText("Generate Key Pair"));
  });

  await waitFor(
    () => {
      const statusText =
        reloadedView.container.querySelector(".pane-content")?.textContent ??
        "";
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

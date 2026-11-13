import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  type RenderResult,
  render,
  waitFor,
} from "@testing-library/react";
import { createFakeIndexedDb } from "../../../test/helpers/fakeIndexedDb";
import { createAppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../../providers/host/AppHostConfigProvider";
import {
  LocalKeyringLockProvider,
  useLocalKeyringLock,
} from "../../providers/local-keyring/LocalKeyringLockProvider";
import type { LocalKeyringLockContextValue } from "../../providers/local-keyring/localKeyringLockActions";
import { AppScreensaverAction, AppScreensaverHost } from "./AppScreensaverHost";

const PIN = "824913";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function wake() {
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.keyUp(window, { key: "Escape" });
}

function submitPin(view: RenderResult, pin: string) {
  fireEvent.change(view.getByLabelText("PIN code"), {
    target: { value: pin },
  });
  fireEvent.click(view.getByRole("button", { name: "Unlock" }));
}

test("the host locks the existing keyring and retains windows until its PIN unlocks", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const hadIndexedDB = "indexedDB" in globalThis;
  Reflect.set(globalThis, "indexedDB", createFakeIndexedDb());
  let keyringLock: LocalKeyringLockContextValue | undefined;
  const hostConfig = createAppHostConfig({
    apiBaseUrl: "http://api.example.test",
    localIdentityNamespace: "screensaver-test",
    wsUrl: "ws://events.example.test",
  });

  function Probe() {
    keyringLock = useLocalKeyringLock();
    return <output aria-label="Keyring state">{keyringLock.status}</output>;
  }

  function scene(mode: string) {
    return (
      <AppHostConfigProvider value={hostConfig}>
        <LocalKeyringLockProvider>
          <AppScreensaverHost>
            <Probe />
            <AppScreensaverAction />
            <section aria-label="Previous window" data-layout={mode}>
              <input aria-label="Unsaved note" defaultValue="Keep this draft" />
            </section>
          </AppScreensaverHost>
        </LocalKeyringLockProvider>
      </AppHostConfigProvider>
    );
  }

  try {
    const view = render(scene("windowed"));
    await waitFor(() => expect(keyringLock?.canManagePinCode).toBe(true));
    const keyring = keyringLock?.createLocalKeyring?.();
    if (!keyring) throw new Error("Expected browser local keyring");
    const session = await keyring.getOrCreateSession({
      namespace: "tearleads.blob-store",
    });
    session.dispose();
    await act(async () => {
      expect(await keyringLock?.setPinCode(PIN)).toBe(true);
    });
    await waitFor(() => expect(keyringLock?.pinCodeEnabled).toBe(true));
    const previousWindow = view.getByRole("region", {
      name: "Previous window",
    });
    const draft = view.getByLabelText("Unsaved note");
    fireEvent.click(view.getByRole("button", { name: "Start Screensaver" }));
    expect(keyringLock?.isLocked).toBe(true);
    expect(view.getByRole("dialog")).toBeTruthy();
    expect(previousWindow.isConnected).toBe(true);

    // A layout update must not remount the host or drop its captured PIN gate.
    view.rerender(scene("routed"));
    wake();
    await waitFor(() => expect(view.getByLabelText("PIN code")).toBeTruthy());
    submitPin(view, "111111");
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("incorrect"),
    );
    expect(keyringLock?.isLocked).toBe(true);
    wake();
    expect(view.getByLabelText("PIN code")).toBeTruthy();

    submitPin(view, PIN);
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(keyringLock?.isLocked).toBe(false);
    expect(view.getByRole("region", { name: "Previous window" })).toBe(
      previousWindow,
    );
    expect(view.getByLabelText("Unsaved note")).toBe(draft);
    expect((draft as HTMLInputElement).value).toBe("Keep this draft");
  } finally {
    cleanup();
    if (hadIndexedDB) Reflect.set(globalThis, "indexedDB", originalIndexedDB);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});

test("isolated peer surfaces do not expose a screensaver without the shared host", () => {
  const view = render(<AppScreensaverAction />);
  expect(view.queryByRole("button", { name: "Start Screensaver" })).toBeNull();
});

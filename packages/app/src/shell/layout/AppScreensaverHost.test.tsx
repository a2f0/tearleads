import { afterEach, expect, test } from "bun:test";
import {
  act,
  fireEvent,
  type RenderResult,
  render,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { createTestAppHostConfig } from "../../../test/helpers/appTestHostConfig";
import { createFakeIndexedDb } from "../../../test/helpers/fakeIndexedDb";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../test/helpers/msw/server";
import { cleanupPaneTestEnvironment } from "../../../test/helpers/paneTestUtils";
import { LocalKeyringUnlockGate } from "../../mini-apps/LocalKeyringUnlockGate";
import { AppRuntimeProvider } from "../../providers/AppRuntimeProvider";
import { useLocalKeyringLock } from "../../providers/local-keyring/LocalKeyringLockProvider";
import type { LocalKeyringLockContextValue } from "../../providers/local-keyring/localKeyringLockActions";
import { AppScreensaverAction, AppScreensaverHost } from "./AppScreensaverHost";

const PIN = "824913";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

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

function DraftEditor() {
  const [draft, setDraft] = useState("");
  return (
    <textarea
      aria-label="Unsaved note"
      onChange={(event) => setDraft(event.target.value)}
      value={draft}
    />
  );
}

test("the PIN privacy screen preserves the live keyring and gated editor through cancellation", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const hadIndexedDB = "indexedDB" in globalThis;
  Reflect.set(globalThis, "indexedDB", createFakeIndexedDb());
  let keyringLock: LocalKeyringLockContextValue | undefined;
  const hostConfig = createTestAppHostConfig().withOverrides({
    createLocalKeyring: undefined,
    localIdentityNamespace: "screensaver-test",
  });

  function Probe() {
    keyringLock = useLocalKeyringLock();
    return <output aria-label="Keyring state">{keyringLock.status}</output>;
  }

  function scene(mode: string) {
    return (
      <AppRuntimeProvider hostConfig={hostConfig} autoProvisionEnabled={false}>
        <AppScreensaverHost>
          <Probe />
          <AppScreensaverAction />
          <section aria-label="Previous window" data-layout={mode}>
            <LocalKeyringUnlockGate
              appName="Notes"
              requireLocalIdentity={false}
            >
              <DraftEditor />
            </LocalKeyringUnlockGate>
          </section>
        </AppScreensaverHost>
      </AppRuntimeProvider>
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
    fireEvent.change(draft, { target: { value: "Keep this draft" } });
    const unlockedState = keyringLock;
    const liveSession = await keyring.getOrCreateSession({
      namespace: "tearleads.blob-store",
    });
    const sessionKey = liveSession.blobStoreKey.slice();
    const assertPreserved = () => {
      expect(keyringLock).toBe(unlockedState);
      expect(keyringLock?.isLocked).toBe(false);
      expect(view.getByLabelText("Unsaved note")).toBe(draft);
      expect((draft as HTMLTextAreaElement).value).toBe("Keep this draft");
      expect(keyringLock?.revision).toBe(unlockedState?.revision);
      expect(liveSession.blobStoreKey).toEqual(sessionKey);
    };
    fireEvent.click(view.getByRole("button", { name: "Start Screensaver" }));
    assertPreserved();
    expect(view.getByRole("dialog")).toBeTruthy();
    expect(previousWindow.isConnected).toBe(true);

    // A host re-render must not remount it or drop its captured PIN gate.
    view.rerender(scene("routed"));
    wake();
    await waitFor(() => expect(view.getByLabelText("PIN code")).toBeTruthy());
    submitPin(view, "111111");
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain("incorrect"),
    );
    assertPreserved();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(view.queryByLabelText("PIN code")).toBeNull();
    expect(view.getByRole("dialog")).toBeTruthy();
    assertPreserved();
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
    wake();
    await waitFor(() => expect(view.getByLabelText("PIN code")).toBeTruthy());

    // Escape cancels the prompt, not the privacy screen.
    wake();
    expect(view.queryByLabelText("PIN code")).toBeNull();
    expect(view.getByRole("dialog")).toBeTruthy();
    assertPreserved();
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
    wake();
    await waitFor(() => expect(view.getByLabelText("PIN code")).toBeTruthy());

    submitPin(view, PIN);
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    assertPreserved();
    expect(view.getByRole("region", { name: "Previous window" })).toBe(
      previousWindow,
    );
    expect(view.getByLabelText("Unsaved note")).toBe(draft);
    expect((draft as HTMLTextAreaElement).value).toBe("Keep this draft");
    liveSession.dispose();
  } finally {
    await cleanupPaneTestEnvironment();
    if (hadIndexedDB) Reflect.set(globalThis, "indexedDB", originalIndexedDB);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});

test("isolated peer surfaces do not expose a screensaver without the shared host", () => {
  const view = render(<AppScreensaverAction />);
  expect(view.queryByRole("button", { name: "Start Screensaver" })).toBeNull();
});

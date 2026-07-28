import { afterEach, expect, test } from "bun:test";
import {
  createLocalStorageLocalKeyringManifestStore,
  LOCAL_KEYRING_MANIFEST_FORMAT,
  type LocalKeyringManifest,
  WRAPPED_LOCAL_SECRET_FORMAT,
} from "@tearleads/client-sdk";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { createFakeIndexedDb } from "../../../../test/helpers/fakeIndexedDb";
import {
  cleanupPaneTestEnvironment,
  clickPaneAppMenuItem,
  createTestHostConfig,
  renderPane,
} from "../../../../test/helpers/paneTestUtils";
import {
  createBrowserLocalKeyringForPinCode,
  pinCodeConfigKey,
} from "../../../providers/local-keyring/localKeyringLockSupport";
import { LOCAL_BLOB_STORE_SCOPE_NAMESPACE } from "../../../providers/local-keyring/localKeyringScopes";

afterEach(cleanupPaneTestEnvironment);

const PIN_CODE_WRAPPING_ALGORITHM = "pin-code-pbkdf2-sha256-aes-256-gcm";
const PIN_CODE_PROVIDER = "pin-code";

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

async function persistUnlockableBlobStoreManifest(
  namespace: string,
  pinCode: string,
): Promise<void> {
  const session = await createBrowserLocalKeyringForPinCode({
    keyMaterialStorage: undefined,
    pinCode,
  }).getOrCreateSession({
    namespace: LOCAL_BLOB_STORE_SCOPE_NAMESPACE,
  });
  session.dispose();
  globalThis.localStorage.setItem(pinCodeConfigKey(namespace), "1");
}

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
        view.getByText(/Unlock your local keys to open System Monitor\./),
      ).toBeTruthy();
    });
    expect(view.getByLabelText("PIN code")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Menu" }));

    const unlockDatabaseItem = view.getByRole("button", {
      name: "Unlock Database",
    });
    expect(unlockDatabaseItem).toBeTruthy();
    expect(view.queryByText("Generate Key Pair")).toBeNull();

    fireEvent.click(unlockDatabaseItem);

    let unlockWindow: HTMLDivElement | null = null;
    await waitFor(() => {
      const closestWindow = view
        .getAllByText("Local keychain locked")
        .map((heading) => heading.closest(".window"))
        .find(
          (window): window is HTMLDivElement =>
            window instanceof HTMLDivElement,
        );
      if (!(closestWindow instanceof HTMLDivElement)) {
        throw new Error("Expected unlock heading to be inside a window.");
      }
      unlockWindow = closestWindow;
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
    clickPaneAppMenuItem(view, "Contacts");

    await waitFor(() => {
      expect(view.getAllByText("Local keychain locked")).toHaveLength(3);
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

test("unlock database floating window closes after successful unlock", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const hadIndexedDB = "indexedDB" in globalThis;
  const localIdentityNamespace = `test-pane-pin-unlock-${crypto.randomUUID()}`;
  const paneLocalIdentityNamespace = `${localIdentityNamespace}.left`;

  try {
    Reflect.set(globalThis, "indexedDB", createFakeIndexedDb());
    await persistUnlockableBlobStoreManifest(
      paneLocalIdentityNamespace,
      "123456",
    );

    const view = renderPane({
      hostConfig: createTestHostConfig({
        createLocalKeyring: null,
        localIdentityNamespace,
      }),
    });

    await waitFor(() => {
      expect(
        view.getByText(/Unlock your local keys to open System Monitor\./),
      ).toBeTruthy();
    });

    fireEvent.click(view.getByRole("button", { name: "Menu" }));
    fireEvent.click(
      view.getByRole("button", {
        name: "Unlock Database",
      }),
    );

    let unlockWindow: HTMLDivElement | null = null;
    await waitFor(() => {
      const closestWindow = view
        .getAllByText("Local keychain locked")
        .map((heading) => heading.closest(".window"))
        .find(
          (window): window is HTMLDivElement =>
            window instanceof HTMLDivElement,
        );
      if (!(closestWindow instanceof HTMLDivElement)) {
        throw new Error("Expected unlock heading to be inside a window.");
      }
      unlockWindow = closestWindow;
    });
    if (!unlockWindow) {
      throw new Error("Expected unlock window.");
    }

    const unlockWindowView = within(unlockWindow);
    fireEvent.change(unlockWindowView.getByLabelText("PIN code"), {
      target: { value: "123456" },
    });
    fireEvent.click(
      unlockWindowView.getByRole("button", {
        name: "Unlock",
      }),
    );

    await waitFor(() => {
      expect(unlockWindow?.isConnected).toBe(false);
      expect(view.queryByText("Local database unlocked")).toBeNull();
    });

    view.unmount();
  } finally {
    if (hadIndexedDB) {
      Reflect.set(globalThis, "indexedDB", originalIndexedDB);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  }
});

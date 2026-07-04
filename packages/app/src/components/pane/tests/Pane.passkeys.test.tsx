import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import {
  openIdentityManagerFromPane,
  registerAndWaitForUserId,
} from "../../../../test/helpers/identityPaneTestUtils";
import {
  cleanupPaneTestEnvironment,
  generateIdentityAndWaitForDb,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
} from "../../../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment);

function restoreDescriptor(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
    return;
  }

  Reflect.deleteProperty(target, property);
}

function installPasskeySupportMock(): () => void {
  const publicKeyCredentialDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "PublicKeyCredential",
  );
  const credentialsDescriptor = Object.getOwnPropertyDescriptor(
    Navigator.prototype,
    "credentials",
  );

  Object.defineProperty(globalThis, "PublicKeyCredential", {
    configurable: true,
    value: function PublicKeyCredential() {},
  });
  Object.defineProperty(Navigator.prototype, "credentials", {
    configurable: true,
    get: () => ({
      create: async () => null,
      get: async () => null,
    }),
  });

  return () => {
    restoreDescriptor(
      globalThis,
      "PublicKeyCredential",
      publicKeyCredentialDescriptor,
    );
    restoreDescriptor(
      Navigator.prototype,
      "credentials",
      credentialsDescriptor,
    );
  };
}

test(
  "passkey controls require the System Monitor feature flag",
  async () => {
    const restorePasskeySupport = installPasskeySupportMock();
    const view = renderPane();

    try {
      await generateIdentityAndWaitForDb(view);
      await registerAndWaitForUserId(view);

      const identityManagerWindow = await openIdentityManagerFromPane(view);
      await waitFor(() => {
        expect(
          within(identityManagerWindow).getByRole("button", {
            name: "Backup Key Package",
          }),
        ).toBeTruthy();
      });
      expect(
        within(identityManagerWindow).queryByRole("button", {
          name: "Backup to Passkey",
        }),
      ).toBeNull();
      expect(
        within(identityManagerWindow).queryByRole("button", {
          name: "Restore from Passkey",
        }),
      ).toBeNull();

      fireEvent.click(view.getByRole("button", { name: "System Monitor" }));
      await view.findByRole("tab", { name: "Logs" });
      const systemMonitorWindow = view.container
        .querySelector(".system-monitor")
        ?.closest(".window");
      if (!(systemMonitorWindow instanceof HTMLDivElement)) {
        throw new Error("Expected System Monitor window.");
      }
      const systemMonitor = within(systemMonitorWindow);
      fireEvent.click(systemMonitor.getByRole("menuitem", { name: "View" }));
      fireEvent.click(
        await systemMonitor.findByRole("menuitem", {
          name: "Enable Developer Mode",
        }),
      );
      fireEvent.click(
        await systemMonitor.findByRole("tab", { name: "Feature Flags" }),
      );
      fireEvent.click(
        systemMonitor.getByRole("switch", {
          name: "Enable passkeys",
        }),
      );

      await waitFor(() => {
        expect(
          within(identityManagerWindow).getByRole("button", {
            name: "Backup to Passkey",
          }),
        ).toBeTruthy();
        expect(
          within(identityManagerWindow).getByRole("button", {
            name: "Restore from Passkey",
          }),
        ).toBeTruthy();
      });

      view.unmount();
    } finally {
      restorePasskeySupport();
    }
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

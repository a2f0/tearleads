import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { createIdentitySeedPhrase } from "@tearleads/crypto";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../test/helpers/msw/server";
import {
  renderLifecyclePane,
  unmountLifecyclePane,
} from "../../test/helpers/paneLifecycleTestUtils";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
} from "../../test/helpers/paneTestUtils";
import {
  installRecoveryQrCamera,
  installRecoveryQrPhoto,
} from "../../test/helpers/recoveryQrCameraTestKit";

let restoreCamera: (() => void) | undefined;
afterEach(async () => {
  restoreCamera?.();
  restoreCamera = undefined;
  await cleanupPaneTestEnvironment();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

function onboardingConfig() {
  return createTestHostConfig({
    autoProvisionIdentity: true,
    promptAccountName: true,
  });
}

test(
  "onboarding restores from a recovery QR code read by the browser camera",
  async () => {
    useTestApiAppHandlers();
    const passphrase = createIdentitySeedPhrase();
    const device = renderLifecyclePane(onboardingConfig());
    const recovery = within(device.pane);
    fireEvent.click(
      await recovery.findByRole("button", { name: "Restore identity" }),
    );
    const camera = installRecoveryQrCamera("unrelated QR");
    restoreCamera = camera.restore;
    fireEvent.click(
      recovery.getByRole("button", { name: "Restore from QR code" }),
    );
    // A code that is not a recovery key keeps the camera open and restores
    // nothing.
    await recovery.findByText(/does not contain a valid recovery key/u);
    expect(recovery.getByLabelText("Recovery QR code camera")).toBeTruthy();
    expect(device.sdk().identity.signingKeyPair).toBeNull();

    // The printed and displayed codes carry the key uppercased.
    camera.setCode(passphrase.toUpperCase());
    await waitFor(
      () => expect(device.sdk().identity.seedPhrase).toBe(passphrase),
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    expect(camera.stopTrack).toHaveBeenCalledTimes(1);
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
    await unmountLifecyclePane(device);
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);

test(
  "a valid recovery QR whose restore fails reports it and offers the scan again",
  async () => {
    useTestApiAppHandlers();
    const passphrase = createIdentitySeedPhrase();
    const device = renderLifecyclePane(onboardingConfig());
    const recovery = within(device.pane);
    fireEvent.click(
      await recovery.findByRole("button", { name: "Restore identity" }),
    );
    // Onboarding derives the restored key package through the SDK identity.
    using importSeedPhrase = spyOn(
      Object.getPrototypeOf(device.sdk().identity),
      "importSeedPhrase",
    ).mockImplementationOnce(async () => {
      throw new Error("Import failed");
    });
    const camera = installRecoveryQrCamera(passphrase.toUpperCase());
    restoreCamera = camera.restore;
    fireEvent.click(
      recovery.getByRole("button", { name: "Restore from QR code" }),
    );
    const alert = await recovery.findByRole("alert", undefined, {
      timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
    });
    expect(alert.textContent).toContain("Could not restore your identity");
    expect(importSeedPhrase).toHaveBeenCalledTimes(1);
    expect(camera.stopTrack).toHaveBeenCalledTimes(1);
    expect(device.sdk().identity.signingKeyPair).toBeNull();
    expect(
      recovery.getByRole("button", { name: "Restore from QR code" }),
    ).toBeTruthy();
    expect(recovery.queryByLabelText("Recovery QR code camera")).toBeNull();
    await unmountLifecyclePane(device);
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);

test(
  "onboarding restores from a recovery QR code captured by a native camera",
  async () => {
    useTestApiAppHandlers();
    const passphrase = createIdentitySeedPhrase();
    const photo = installRecoveryQrPhoto(passphrase.toUpperCase());
    restoreCamera = photo.restore;
    const capturePhoto = mock(
      async () => new Blob(["host photo"], { type: "image/jpeg" }),
    );
    const device = renderLifecyclePane(
      onboardingConfig().withOverrides({
        createScanner: () => ({ capturePhoto }),
      }),
    );
    const recovery = within(device.pane);
    fireEvent.click(
      await recovery.findByRole("button", { name: "Restore identity" }),
    );
    await act(async () => {
      fireEvent.click(
        recovery.getByRole("button", { name: "Restore from QR code" }),
      );
    });
    await waitFor(
      () => expect(device.sdk().identity.seedPhrase).toBe(passphrase),
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    expect(capturePhoto).toHaveBeenCalledTimes(1);
    expect(photo.close).toHaveBeenCalledTimes(1);
    expect(photo.camera.getUserMedia).not.toHaveBeenCalled();
    await unmountLifecyclePane(device);
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 2,
);

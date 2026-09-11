import { afterEach, beforeEach, expect, test } from "bun:test";
import { createIdentitySeedPhraseFromEntropy } from "@tearleads/crypto";
import { act, fireEvent, waitFor } from "@testing-library/react";
import encodeQR from "qr";
import { TestWebSocket } from "../../../../test/helpers/identityManagerTestRuntime";
import {
  ACKNOWLEDGEMENT_LABEL,
  cleanupRecoveryKeyTestEnvironment,
  renderRecoveryKeyView,
} from "../../../../test/helpers/recoveryKeyTestKit";
import { installRecoveryQrCamera } from "../../../../test/helpers/recoveryQrCameraTestKit";
import "../../../../test/helpers/mswServer";

const originalWebSocket = globalThis.WebSocket;
let camera: ReturnType<typeof installRecoveryQrCamera> | undefined;
beforeEach(() => Reflect.set(globalThis, "WebSocket", TestWebSocket));
afterEach(async () => {
  await cleanupRecoveryKeyTestEnvironment();
  camera?.restore();
  camera = undefined;
  Reflect.set(globalThis, "WebSocket", originalWebSocket);
});

test("QR disclosure is acknowledged, contains only the key, and can be hidden", async () => {
  const { seedPhrase, view } = await renderRecoveryKeyView(0x12);
  expect(view.queryByAltText("Recovery key QR code")).toBeNull();
  fireEvent.click(
    view.getByRole("button", { name: "Reveal Recovery QR Code" }),
  );
  expect(
    (view.getByRole("button", { name: "Show QR Code" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(view.queryByAltText("Recovery key QR code")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(view.queryByAltText("Recovery key QR code")).toBeNull();
  fireEvent.click(
    view.getByRole("button", { name: "Reveal Recovery QR Code" }),
  );
  fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
    target: { value: "i understand" },
  });
  fireEvent.click(view.getByRole("button", { name: "Show QR Code" }));
  const image = await view.findByAltText("Recovery key QR code");
  const source = image.getAttribute("src") ?? "";
  expect(decodeURIComponent(source.slice("data:image/svg+xml,".length))).toBe(
    encodeQR(seedPhrase, "svg", { border: 4, ecc: "medium" }),
  );
  fireEvent.click(view.getByRole("button", { name: "Reveal Recovery Key" }));
  fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
    target: { value: "i understand" },
  });
  fireEvent.click(view.getByRole("button", { name: "Show Passphrase" }));
  expect(view.getByDisplayValue(seedPhrase)).toBeTruthy();
  expect(view.getByAltText("Recovery key QR code")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Hide Recovery Key" }));
  expect(view.queryByAltText("Recovery key QR code")).toBeNull();
  expect(view.queryByDisplayValue(seedPhrase)).toBeNull();
});

test("switching identities or leaving Backup revokes QR disclosure", async () => {
  const { tearleads, view } = await renderRecoveryKeyView(0x13);
  const reveal = () => {
    fireEvent.click(
      view.getByRole("button", { name: "Reveal Recovery QR Code" }),
    );
    fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
      target: { value: "i understand" },
    });
    fireEvent.click(view.getByRole("button", { name: "Show QR Code" }));
  };
  reveal();
  fireEvent.click(view.getByRole("tab", { name: "Recovery" }));
  fireEvent.click(view.getByRole("tab", { name: "Backup" }));
  expect(view.queryByAltText("Recovery key QR code")).toBeNull();
  reveal();
  await act(async () => {
    await tearleads.identity.importSeedPhrase(
      createIdentitySeedPhraseFromEntropy(new Uint8Array(32).fill(0x14)),
    );
  });
  expect(view.queryByAltText("Recovery key QR code")).toBeNull();
});

test("scanning validates the QR and restores through the existing login flow", async () => {
  const { seedPhrase, tearleads, view } = await renderRecoveryKeyView(0x15);
  const incoming = createIdentitySeedPhraseFromEntropy(
    new Uint8Array(32).fill(0x16),
  );
  camera = installRecoveryQrCamera("https://example.com/not-a-recovery-key");
  fireEvent.click(view.getByRole("tab", { name: "Recovery" }));
  expect(camera.getUserMedia).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  await view.findByText(/does not contain a valid recovery key/u);
  expect(tearleads.identity.seedPhrase).toBe(seedPhrase);
  expect(
    (view.getByLabelText("Restore passphrase") as HTMLTextAreaElement).value,
  ).toBe("");
  camera.setCode(incoming.toUpperCase().replaceAll(" ", "  "));
  await waitFor(() =>
    expect(
      (view.getByLabelText("Restore passphrase") as HTMLTextAreaElement).value,
    ).toBe(incoming),
  );
  expect(tearleads.identity.seedPhrase).toBe(seedPhrase);
  expect(view.queryByLabelText("Recovery QR code camera")).toBeNull();
  expect(camera.stopTrack).toHaveBeenCalledTimes(1);
  fireEvent.click(
    view.getByRole("button", { name: "Restore from Passphrase" }),
  );
  await view.findByText("Recovery key restored.");
  expect(tearleads.identity.seedPhrase).toBe(incoming);
  expect(tearleads.session.isAuthenticated).toBe(true);
});

test("cancelling and changing tabs release the camera", async () => {
  const { view } = await renderRecoveryKeyView(0x17);
  camera = installRecoveryQrCamera("unrelated QR");
  fireEvent.click(view.getByRole("tab", { name: "Recovery" }));
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  await view.findByText(/does not contain a valid recovery key/u);
  fireEvent.click(view.getByRole("button", { name: "Cancel Scan" }));
  expect(camera.stopTrack).toHaveBeenCalledTimes(1);
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  await view.findByText(/does not contain a valid recovery key/u);
  fireEvent.click(view.getByRole("tab", { name: "Backup" }));
  expect(camera.stopTrack).toHaveBeenCalledTimes(2);
});

test("clearing a scanned phrase or leaving Recovery removes staged recovery feedback", async () => {
  const { seedPhrase, view } = await renderRecoveryKeyView(0x18);
  camera = installRecoveryQrCamera(seedPhrase);
  fireEvent.click(view.getByRole("tab", { name: "Recovery" }));
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  await view.findByText(/Choose Restore from Passphrase/u);
  fireEvent.change(view.getByLabelText("Restore passphrase"), {
    target: { value: "" },
  });
  expect(view.queryByText(/Choose Restore from Passphrase/u)).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  await view.findByText(/Choose Restore from Passphrase/u);
  fireEvent.click(view.getByRole("tab", { name: "Backup" }));
  fireEvent.click(view.getByRole("tab", { name: "Recovery" }));
  expect(
    (view.getByLabelText("Restore passphrase") as HTMLTextAreaElement).value,
  ).toBe("");
  expect(view.queryByText(/Choose Restore from Passphrase/u)).toBeNull();
});

test("losing and restoring the seed for the same identity revokes QR disclosure", async () => {
  const { tearleads, view } = await renderRecoveryKeyView(0x19);
  const keyPackage = await tearleads.identity.exportKeyPackage();
  fireEvent.click(
    view.getByRole("button", { name: "Reveal Recovery QR Code" }),
  );
  fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
    target: { value: "i understand" },
  });
  fireEvent.click(view.getByRole("button", { name: "Show QR Code" }));
  expect(view.getByAltText("Recovery key QR code")).toBeTruthy();
  await act(async () => {
    await tearleads.identity.importKeyPackage({
      ...keyPackage,
      seedPhrase: undefined,
    });
  });
  expect(tearleads.identity.signingFingerprint).toBe(
    keyPackage.signingFingerprint,
  );
  expect(view.queryByAltText("Recovery key QR code")).toBeNull();
  await act(async () => {
    await tearleads.identity.importKeyPackage(keyPackage);
  });
  expect(view.queryByAltText("Recovery key QR code")).toBeNull();
});

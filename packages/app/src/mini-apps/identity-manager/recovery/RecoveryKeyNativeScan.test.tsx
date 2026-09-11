import { afterEach, expect, mock, test } from "bun:test";
import { createIdentitySeedPhraseFromEntropy } from "@tearleads/crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { createIdentityManagerHostConfig } from "../../../../test/helpers/identityManagerTestRuntime";
import { installRecoveryQrPhoto } from "../../../../test/helpers/recoveryQrCameraTestKit";
import { AppHostConfigProvider } from "../../../providers/host/AppHostConfigProvider";
import { RecoveryKeyNativeScan } from "./RecoveryKeyNativeScan";
import { RecoveryKeyRestoreForm } from "./RecoveryKeyRestoreForm";

const phrase = createIdentitySeedPhraseFromEntropy(
  new Uint8Array(32).fill(0x20),
);
let photo: ReturnType<typeof installRecoveryQrPhoto> | undefined;
afterEach(() => {
  cleanup();
  photo?.restore();
});

test("a host camera captures and decodes recovery without browser camera APIs", async () => {
  photo = installRecoveryQrPhoto(phrase);
  const blob = new Blob(["host photo"], { type: "image/jpeg" });
  const capturePhoto = mock(async () => blob);
  const onScan = mock(() => undefined);
  const host = createIdentityManagerHostConfig().withOverrides({
    createScanner: () => ({ capturePhoto }),
  });
  const view = render(
    <AppHostConfigProvider value={host}>
      <RecoveryKeyRestoreForm
        busy={null}
        canRestore
        identityTransitionInFlight={false}
        localKeyringLocked={false}
        onRestore={async () => undefined}
        restorePassphrase=""
        setRestorePassphrase={onScan}
      />
    </AppHostConfigProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  await waitFor(() => expect(onScan).toHaveBeenCalledWith(phrase));
  expect(capturePhoto).toHaveBeenCalledTimes(1);
  expect(photo.createBitmap).toHaveBeenCalledWith(blob);
  expect(photo.close).toHaveBeenCalledTimes(1);
  expect(photo.camera.getUserMedia).not.toHaveBeenCalled();
});

test("native camera cancellation does not decode or change the phrase", async () => {
  photo = installRecoveryQrPhoto(phrase);
  const onScan = mock(() => undefined);
  const view = render(
    <RecoveryKeyNativeScan
      disabled={false}
      onScan={onScan}
      scanner={{ capturePhoto: async () => null }}
    />,
  );
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  });
  expect(onScan).not.toHaveBeenCalled();
  expect(photo.createBitmap).not.toHaveBeenCalled();
  expect(view.queryByRole("alert")).toBeNull();
});

test("invalid native QR contents announce an error and permit retry", async () => {
  photo = installRecoveryQrPhoto("unrelated QR");
  const onScan = mock(() => undefined);
  const view = render(
    <RecoveryKeyNativeScan
      disabled={false}
      onScan={onScan}
      scanner={{ capturePhoto: async () => new Blob() }}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  expect((await view.findByRole("alert")).textContent).toContain(
    "valid recovery key",
  );
  expect(onScan).not.toHaveBeenCalled();
  photo.camera.setCode(phrase);
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  await waitFor(() => expect(onScan).toHaveBeenCalledWith(phrase));
});

test.each(["lock", "unmount"])(
  "a native capture arriving after %s is ignored",
  async (action) => {
    photo = installRecoveryQrPhoto(phrase);
    const pending = Promise.withResolvers<Blob | null>();
    const scanner = { capturePhoto: () => pending.promise };
    const onScan = mock(() => undefined);
    const view = render(
      <RecoveryKeyNativeScan
        disabled={false}
        onScan={onScan}
        scanner={scanner}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
    if (action === "lock")
      view.rerender(
        <RecoveryKeyNativeScan disabled onScan={onScan} scanner={scanner} />,
      );
    else view.unmount();
    await act(async () => {
      pending.resolve(new Blob());
    });
    expect(onScan).not.toHaveBeenCalled();
    expect(photo.createBitmap).not.toHaveBeenCalled();
  },
);

test("native camera failures show an actionable error without exception details", async () => {
  photo = installRecoveryQrPhoto(phrase);
  const onScan = mock(() => undefined);
  const view = render(
    <RecoveryKeyNativeScan
      disabled={false}
      onScan={onScan}
      scanner={{
        capturePhoto: async () => {
          throw new Error("private photo path");
        },
      }}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  const alert = await view.findByRole("alert");
  expect(alert.textContent).toContain("Check camera access");
  expect(alert.textContent).not.toContain("private photo path");
  expect(onScan).not.toHaveBeenCalled();
});

test("a photo decoded after locking is released without delivering the key", async () => {
  photo = installRecoveryQrPhoto(phrase);
  const pending = Promise.withResolvers<ImageBitmap>();
  photo.createBitmap.mockImplementation(() => pending.promise);
  const close = mock(() => undefined);
  const scanner = { capturePhoto: async () => new Blob() };
  const onScan = mock(() => undefined);
  const view = render(
    <RecoveryKeyNativeScan
      disabled={false}
      onScan={onScan}
      scanner={scanner}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  await waitFor(() => expect(photo?.createBitmap).toHaveBeenCalled());
  view.rerender(
    <RecoveryKeyNativeScan disabled onScan={onScan} scanner={scanner} />,
  );
  await act(async () => {
    pending.resolve({ width: 320, height: 320, close } as ImageBitmap);
  });
  expect(close).toHaveBeenCalledTimes(1);
  expect(onScan).not.toHaveBeenCalled();
});

test("a photo with no QR code asks for the recovery code without blaming camera access", async () => {
  photo = installRecoveryQrPhoto(phrase);
  photo.camera.clearFrame();
  const onScan = mock(() => undefined);
  const view = render(
    <RecoveryKeyNativeScan
      disabled={false}
      onScan={onScan}
      scanner={{ capturePhoto: async () => new Blob() }}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  const alert = await view.findByRole("alert");
  expect(alert.textContent).toContain("does not contain a valid recovery key");
  expect(alert.textContent).not.toContain("camera access");
  expect(photo.close).toHaveBeenCalledTimes(1);
  expect(onScan).not.toHaveBeenCalled();
});

import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { installRecoveryQrCamera } from "../../../../test/helpers/recoveryQrCameraTestKit";
import { RecoveryKeyScanControl } from "./RecoveryKeyScanControl";

let camera: ReturnType<typeof installRecoveryQrCamera> | undefined;
afterEach(() => {
  cleanup();
  camera?.restore();
});

test("locking during a scan releases the camera and does not restart on unlock", async () => {
  camera = installRecoveryQrCamera("unrelated QR");
  const onScan = mock(() => undefined);
  const view = render(
    <RecoveryKeyScanControl disabled={false} onScan={onScan} />,
  );
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  await view.findByText(/does not contain a valid recovery key/u);
  view.rerender(<RecoveryKeyScanControl disabled onScan={onScan} />);
  expect(camera.stopTrack).toHaveBeenCalledTimes(1);
  expect(
    (view.getByRole("button", { name: "Scan QR Code" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  view.rerender(<RecoveryKeyScanControl disabled={false} onScan={onScan} />);
  expect(view.queryByLabelText("Recovery QR code camera")).toBeNull();
  expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
  expect(onScan).not.toHaveBeenCalled();
});

test("leaving the page releases the camera", async () => {
  camera = installRecoveryQrCamera("unrelated QR");
  const onScan = mock(() => undefined);
  const view = render(
    <RecoveryKeyScanControl disabled={false} onScan={onScan} />,
  );
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  await view.findByText(/does not contain a valid recovery key/u);
  fireEvent(window, new Event("pagehide"));
  expect(camera.stopTrack).toHaveBeenCalledTimes(1);
  expect(view.queryByLabelText("Recovery QR code camera")).toBeNull();
  expect(onScan).not.toHaveBeenCalled();
});

test("unmounting a scanner releases the camera", async () => {
  camera = installRecoveryQrCamera("unrelated QR");
  const view = render(
    <RecoveryKeyScanControl disabled={false} onScan={() => undefined} />,
  );
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  await view.findByText(/does not contain a valid recovery key/u);
  view.unmount();
  expect(camera.stopTrack).toHaveBeenCalledTimes(1);
});

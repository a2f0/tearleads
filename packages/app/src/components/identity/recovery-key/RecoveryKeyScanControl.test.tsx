import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
    <RecoveryKeyScanControl
      label="Scan QR Code"
      disabled={false}
      onScan={onScan}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  await view.findByText(/does not contain a valid recovery key/u);
  view.rerender(
    <RecoveryKeyScanControl label="Scan QR Code" disabled onScan={onScan} />,
  );
  expect(camera.stopTrack).toHaveBeenCalledTimes(1);
  expect(
    (view.getByRole("button", { name: "Scan QR Code" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  view.rerender(
    <RecoveryKeyScanControl
      label="Scan QR Code"
      disabled={false}
      onScan={onScan}
    />,
  );
  expect(view.queryByLabelText("Recovery QR code camera")).toBeNull();
  expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
  expect(onScan).not.toHaveBeenCalled();
});

test("leaving the page releases the camera", async () => {
  camera = installRecoveryQrCamera("unrelated QR");
  const onScan = mock(() => undefined);
  const view = render(
    <RecoveryKeyScanControl
      label="Scan QR Code"
      disabled={false}
      onScan={onScan}
    />,
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
    <RecoveryKeyScanControl
      label="Scan QR Code"
      disabled={false}
      onScan={() => undefined}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  await view.findByText(/does not contain a valid recovery key/u);
  view.unmount();
  expect(camera.stopTrack).toHaveBeenCalledTimes(1);
});

test("backgrounding the app releases the camera without restarting on return", async () => {
  camera = installRecoveryQrCamera("unrelated QR");
  const onScan = mock(() => undefined);
  const view = render(
    <RecoveryKeyScanControl
      label="Scan QR Code"
      disabled={false}
      onScan={onScan}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  await view.findByText(/does not contain a valid recovery key/u);
  const original = Object.getOwnPropertyDescriptor(document, "visibilityState");
  try {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    fireEvent(document, new Event("visibilitychange"));
    expect(camera.stopTrack).toHaveBeenCalledTimes(1);
    expect(view.queryByLabelText("Recovery QR code camera")).toBeNull();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    fireEvent(document, new Event("visibilitychange"));
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
    expect(onScan).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(document, "visibilityState", original);
    else Reflect.deleteProperty(document, "visibilityState");
  }
});

function renderOpenScanner() {
  const onScan = mock((_phrase: string) => undefined);
  const view = render(
    <RecoveryKeyScanControl
      label="Scan QR Code"
      disabled={false}
      onScan={onScan}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Scan QR Code" }));
  const overlay = () =>
    view.container.querySelector(".recovery-key-scan-overlay");
  const outline = () =>
    view.container.querySelector(".recovery-key-scan-outline");
  return { onScan, outline, overlay, view };
}

test("an empty view shows the viewfinder and asks for the code", async () => {
  camera = installRecoveryQrCamera("unrelated QR");
  camera.clearFrame();
  const { outline, overlay, view } = renderOpenScanner();
  await view.findByText("Point your camera at your recovery QR code.");
  expect(overlay()?.getAttribute("data-status")).toBe("searching");
  expect(view.container.querySelector(".recovery-key-scan-guide")).toBeTruthy();
  expect(outline()).toBeNull();
  expect(view.queryByRole("alert")).toBeNull();
});

test("a located code is outlined while it is still being read", async () => {
  camera = installRecoveryQrCamera("unrelated QR");
  camera.setUnreadableCode("unrelated QR");
  const { onScan, outline, overlay, view } = renderOpenScanner();
  await view.findByText("QR code found. Hold steady while it is read.");
  expect(overlay()?.getAttribute("data-status")).toBe("located");
  expect(outline()?.getAttribute("points")?.split(" ")).toHaveLength(4);
  expect(view.queryByRole("alert")).toBeNull();
  expect(onScan).not.toHaveBeenCalled();
});

test("a code that is not a recovery key is outlined as rejected", async () => {
  camera = installRecoveryQrCamera("https://example.com/not-a-recovery-key");
  const { onScan, outline, overlay, view } = renderOpenScanner();
  await view.findByText(/does not contain a valid recovery key/u);
  expect(overlay()?.getAttribute("data-status")).toBe("rejected");
  expect(outline()).toBeTruthy();
  expect(
    view.getByText("Point your camera at your recovery QR code."),
  ).toBeTruthy();
  expect(onScan).not.toHaveBeenCalled();
});

test("the preview and overlay take a wide frame's shape and coordinates", async () => {
  camera = installRecoveryQrCamera("unrelated QR");
  camera.setCodeInFrame("unrelated QR", {
    width: 480,
    height: 320,
    x: 320,
    y: 120,
  });
  const { outline, overlay, view } = renderOpenScanner();
  await view.findByText(/does not contain a valid recovery key/u);
  expect(overlay()?.getAttribute("viewBox")).toBe("0 0 480 320");
  expect(
    view.container
      .querySelector(".recovery-key-scan-viewport")
      ?.getAttribute("style"),
  ).toContain("aspect-ratio: 480 / 320");
  const xs = (outline()?.getAttribute("points") ?? "")
    .split(" ")
    .map((point) => Number(point.split(",")[0]));
  expect(xs).toHaveLength(4);
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(320);
});

test("the camera says it is starting until its first frame", async () => {
  camera = installRecoveryQrCamera("unrelated QR");
  const pending = Promise.withResolvers<MediaStream>();
  camera.getUserMedia.mockImplementation(() => pending.promise);
  const { overlay, view } = renderOpenScanner();
  await waitFor(() => expect(camera?.getUserMedia).toHaveBeenCalled());
  expect(view.getByText("Starting the camera...")).toBeTruthy();
  expect(overlay()).toBeNull();
  pending.resolve(camera.stream);
  await view.findByText(/does not contain a valid recovery key/u);
  expect(view.queryByText("Starting the camera...")).toBeNull();
});

test("a camera failure replaces the hint with an actionable error", async () => {
  camera = installRecoveryQrCamera("unrelated QR");
  camera.getUserMedia.mockRejectedValue(
    new DOMException("private details", "NotAllowedError"),
  );
  const { overlay, view } = renderOpenScanner();
  const alert = await view.findByRole("alert");
  expect(alert.textContent).toContain("Camera access was denied");
  expect(alert.textContent).not.toContain("private details");
  expect(view.queryByText("Starting the camera...")).toBeNull();
  expect(overlay()).toBeNull();
});

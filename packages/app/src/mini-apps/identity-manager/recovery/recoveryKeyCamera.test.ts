import { afterEach, expect, mock, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { installRecoveryQrCamera } from "../../../../test/helpers/recoveryQrCameraTestKit";
import { startRecoveryKeyCamera } from "./recoveryKeyCamera";

let camera: ReturnType<typeof installRecoveryQrCamera> | undefined;
let cancel: (() => void) | undefined;
afterEach(() => {
  cancel?.();
  camera?.restore();
});

test("decodes frames once and releases the camera after acceptance", async () => {
  camera = installRecoveryQrCamera("recovery test");
  const video = document.createElement("video");
  const onDecode = mock(() => true);
  const onError = mock(() => undefined);
  cancel = startRecoveryKeyCamera(video, { onDecode, onError });
  await waitFor(() => expect(onDecode).toHaveBeenCalledWith("recovery test"));
  expect(onDecode).toHaveBeenCalledTimes(1);
  expect(camera.stopTrack).toHaveBeenCalledTimes(1);
  expect(video.srcObject).toBeNull();
  expect(onError).not.toHaveBeenCalled();
  expect(camera.getUserMedia).toHaveBeenCalledWith({
    audio: false,
    video: { facingMode: { ideal: "environment" } },
  });
});

test("cancellation releases a stream granted after the scan closed", async () => {
  camera = installRecoveryQrCamera("recovery test");
  const pending = Promise.withResolvers<MediaStream>();
  camera.getUserMedia.mockImplementation(() => pending.promise);
  const video = document.createElement("video");
  const onDecode = mock(() => true);
  cancel = startRecoveryKeyCamera(video, {
    onDecode,
    onError: () => undefined,
  });
  await waitFor(() => expect(camera?.getUserMedia).toHaveBeenCalled());
  cancel();
  pending.resolve(camera.stream);
  await waitFor(() => expect(camera?.stopTrack).toHaveBeenCalledTimes(1));
  expect(camera.play).not.toHaveBeenCalled();
  expect(onDecode).not.toHaveBeenCalled();
});

test("permission denial reports a safe actionable error", async () => {
  camera = installRecoveryQrCamera("recovery test");
  camera.getUserMedia.mockRejectedValue(
    new DOMException("private details", "NotAllowedError"),
  );
  const onError = mock(() => undefined);
  cancel = startRecoveryKeyCamera(document.createElement("video"), {
    onDecode: () => true,
    onError,
  });
  await waitFor(() =>
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("Camera access was denied"),
    ),
  );
  expect(camera.play).not.toHaveBeenCalled();
});

test("failed video playback releases the acquired stream", async () => {
  camera = installRecoveryQrCamera("recovery test");
  camera.play.mockRejectedValue(new Error("play failed"));
  const onError = mock(() => undefined);
  const video = document.createElement("video");
  cancel = startRecoveryKeyCamera(video, { onDecode: () => true, onError });
  await waitFor(() => expect(onError).toHaveBeenCalled());
  expect(camera.stopTrack).toHaveBeenCalledTimes(1);
  expect(video.srcObject).toBeNull();
});

test("immediate cancellation never requests camera permission", async () => {
  camera = installRecoveryQrCamera("recovery test");
  cancel = startRecoveryKeyCamera(document.createElement("video"), {
    onDecode: () => true,
    onError: () => undefined,
  });
  cancel();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(camera.getUserMedia).not.toHaveBeenCalled();
});

test("missing camera support preserves manual recovery", async () => {
  camera = installRecoveryQrCamera("recovery test");
  Object.defineProperty(Navigator.prototype, "mediaDevices", {
    configurable: true,
    get: () => undefined,
  });
  const onError = mock(() => undefined);
  cancel = startRecoveryKeyCamera(document.createElement("video"), {
    onDecode: () => true,
    onError,
  });
  expect(onError).toHaveBeenCalledWith(
    expect.stringContaining("browser or device settings"),
  );
  expect(camera.getUserMedia).not.toHaveBeenCalled();
});

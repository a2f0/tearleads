import { afterEach, expect, mock, test } from "bun:test";
import { createIdentitySeedPhraseFromEntropy } from "@tearleads/crypto";
import { waitFor } from "@testing-library/react";
import { installRecoveryQrCamera } from "../../../../test/helpers/recoveryQrCameraTestKit";
import { recoveryKeyScanPhrase } from "../../../identity/recoveryKeyScanPhrase";
import { startRecoveryKeyCamera } from "./recoveryKeyCamera";
import type { RecoveryQrFrame } from "./recoveryKeyScanState";

let camera: ReturnType<typeof installRecoveryQrCamera> | undefined;
let cancel: (() => void) | undefined;

test("both camera paths normalize valid phrases and reject oversized scan payloads", () => {
  const phrase = createIdentitySeedPhraseFromEntropy(
    new Uint8Array(32).fill(0x23),
  );
  expect(recoveryKeyScanPhrase(phrase.toUpperCase())).toBe(phrase);
  expect(recoveryKeyScanPhrase(`${" ".repeat(512)}${phrase}`)).toBeNull();
  expect(recoveryKeyScanPhrase(null)).toBeNull();
  expect(recoveryKeyScanPhrase("unrelated QR")).toBeNull();
  expect(
    recoveryKeyScanPhrase(phrase.split(" ").slice(0, 12).join(" ")),
  ).toBeNull();
});
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
    video: {
      facingMode: { ideal: "environment" },
      height: { ideal: 720 },
      width: { ideal: 1280 },
    },
  });
});

test("reports each unfinished frame with the code it located", async () => {
  camera = installRecoveryQrCamera("unrelated QR");
  const onFrame = mock((_frame: RecoveryQrFrame) => undefined);
  cancel = startRecoveryKeyCamera(document.createElement("video"), {
    onDecode: () => false,
    onError: () => undefined,
    onFrame,
  });
  await waitFor(() => expect(onFrame).toHaveBeenCalled());
  const rejected = onFrame.mock.calls[0]?.[0];
  expect(rejected?.rejected).toBe(true);
  expect(rejected?.outline).toHaveLength(4);
  expect(rejected?.width).toBeGreaterThan(0);
  expect(rejected?.height).toBeGreaterThan(0);

  camera.clearFrame();
  const calls = onFrame.mock.calls.length;
  await waitFor(() =>
    expect(onFrame.mock.calls.length).toBeGreaterThan(calls + 1),
  );
  const empty = onFrame.mock.calls.at(-1)?.[0];
  expect(empty?.rejected).toBe(false);
  expect(empty?.outline).toBeUndefined();
});

test("a decode callback that closes the scan stops frame reports", async () => {
  camera = installRecoveryQrCamera("unrelated QR");
  const onFrame = mock(() => undefined);
  const onDecode = mock(() => {
    cancel?.();
    return false;
  });
  cancel = startRecoveryKeyCamera(document.createElement("video"), {
    onDecode,
    onError: () => undefined,
    onFrame,
  });
  await waitFor(() => expect(onDecode).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(onDecode).toHaveBeenCalledTimes(1);
  expect(onFrame).not.toHaveBeenCalled();
  expect(camera.stopTrack).toHaveBeenCalledTimes(1);
});

test("an accepted frame is not reported as feedback", async () => {
  camera = installRecoveryQrCamera("recovery test");
  const onFrame = mock(() => undefined);
  const onDecode = mock(() => true);
  cancel = startRecoveryKeyCamera(document.createElement("video"), {
    onDecode,
    onError: () => undefined,
    onFrame,
  });
  await waitFor(() => expect(onDecode).toHaveBeenCalledTimes(1));
  expect(onFrame).not.toHaveBeenCalled();
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

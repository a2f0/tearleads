import type { Quad } from "qr/decode.js";
import type { RecoveryQrFrame } from "./recoveryKeyScanState";

interface RecoveryKeyCameraCallbacks {
  /** Returns true when the value finishes the scan and the camera may stop. */
  readonly onDecode: (value: string) => boolean;
  readonly onError: (message: string) => void;
  /** Reports each frame that did not finish the scan, for live feedback. */
  readonly onFrame?: ((frame: RecoveryQrFrame) => void) | undefined;
}

// Ask for enough pixels that a dense recovery QR held at arm's length still
// spans several pixels per module; frames are scaled down before decoding.
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    height: { ideal: 720 },
    width: { ideal: 1280 },
  },
};
const DECODE_MAX_SIDE = 960;
// Wait at least as long as the last decode took, so scanning never holds more
// than half of the main thread on a slow device.
const MIN_SCAN_GAP_MS = 80;

interface RecoveryQrRead {
  readonly frame: RecoveryQrFrame;
  readonly value: string | undefined;
}

function cameraErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Camera access was denied. Allow camera access and try again, or enter your passphrase.";
    }
    if (error.name === "NotFoundError") {
      return "No camera was found. Connect a camera or enter your passphrase.";
    }
  }
  return "Could not start the camera. Close other apps using it and try again, or enter your passphrase.";
}

function readRecoveryQrFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  decode: typeof import("qr/decode.js").default,
): RecoveryQrRead | undefined {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
  const scale = Math.min(
    1,
    DECODE_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight),
  );
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  // A holder keeps the callback's write visible to control-flow analysis.
  const located: { outline?: Quad } = {};
  let value: string | undefined;
  try {
    value = decode(pixels, {
      pointsOnDetect: (points) => {
        located.outline = points.outline;
      },
    });
  } catch {
    // An undecodable frame is normal while the camera focuses.
  } finally {
    pixels.data.fill(0);
  }
  return {
    frame: {
      at: performance.now(),
      height: pixels.height,
      outline: located.outline,
      rejected: value !== undefined,
      width: pixels.width,
    },
    value,
  };
}

/** Own the stream even while permission or video playback is still pending. */
export function startRecoveryKeyCamera(
  video: HTMLVideoElement,
  { onDecode, onError, onFrame }: RecoveryKeyCameraCallbacks,
): () => void {
  let stopped = false;
  let stream: MediaStream | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const canvas = document.createElement("canvas");

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    for (const track of stream?.getTracks() ?? []) track.stop();
    if (stream && video.srcObject === stream) {
      video.pause();
      video.srcObject = null;
    }
    canvas.width = 0;
    canvas.height = 0;
  };

  const fail = (message: string) => {
    if (stopped) return;
    stop();
    onError(message);
  };

  const report = (read: RecoveryQrRead | undefined) => {
    if (read?.value !== undefined && onDecode(read.value)) {
      stop();
      return;
    }
    // A callback may have closed the scan; report nothing after that.
    if (!stopped && read) onFrame?.(read.frame);
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      fail(
        "Camera scanning is unavailable here. Allow camera access in your browser or device settings, or enter your passphrase.",
      );
      return;
    }
    // Decoding stays out of the initial bundle and works without BarcodeDetector.
    const decoder = await import("qr/decode.js").catch(() => null);
    if (stopped) return;
    if (!decoder) {
      fail(
        "Could not load QR scanning. Check your connection and try again, or enter your passphrase.",
      );
      return;
    }
    const { default: decodeQR } = decoder;
    const acquired =
      await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
    if (stopped) {
      for (const track of acquired.getTracks()) track.stop();
      return;
    }
    stream = acquired;
    video.srcObject = stream;
    await video.play();
    if (stopped) return;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      fail(
        "Camera scanning is unavailable on this device. Enter your passphrase instead.",
      );
      return;
    }

    const scan = () => {
      if (stopped) return;
      try {
        const startedAt = performance.now();
        report(readRecoveryQrFrame(video, canvas, context, decodeQR));
        if (stopped) return;
        const elapsed = performance.now() - startedAt;
        timer = setTimeout(scan, Math.max(MIN_SCAN_GAP_MS, elapsed));
      } catch {
        fail(
          "Could not read the camera. Try scanning again or enter your passphrase.",
        );
      }
    };
    scan();
  };

  void start().catch((error: unknown) => fail(cameraErrorMessage(error)));
  return stop;
}

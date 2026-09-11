interface RecoveryKeyCameraCallbacks {
  readonly onDecode: (value: string) => boolean;
  readonly onError: (message: string) => void;
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
): string | undefined {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
  const scale = Math.min(
    1,
    960 / Math.max(video.videoWidth, video.videoHeight),
  );
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  try {
    return decode(pixels);
  } catch {
    // An undecodable frame is normal while the camera focuses.
    return undefined;
  }
}

/** Own the stream even while permission or video playback is still pending. */
export function startRecoveryKeyCamera(
  video: HTMLVideoElement,
  { onDecode, onError }: RecoveryKeyCameraCallbacks,
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
    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
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
        const decoded = readRecoveryQrFrame(video, canvas, context, decodeQR);
        if (decoded !== undefined && onDecode(decoded)) {
          stop();
          return;
        }
        timer = setTimeout(scan, 150);
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

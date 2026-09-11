import { mock, spyOn } from "bun:test";
import encodeQR from "qr";

/** Real QR pixels keep camera tests exercising the production decoder. */
function recoveryQrPixels(value: string): ImageData {
  const matrix = encodeQR(value, "raw", { border: 4 });
  const width = matrix.length * 4;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const shade = matrix[Math.floor(y / 4)]?.[Math.floor(x / 4)] ? 0 : 255;
      data[offset] = shade;
      data[offset + 1] = shade;
      data[offset + 2] = shade;
      data[offset + 3] = 255;
    }
  }
  return { width, height: width, data, colorSpace: "srgb" };
}

export function installRecoveryQrCamera(value: string) {
  let pixels = recoveryQrPixels(value);
  const stopTrack = mock(() => undefined);
  const stream = new MediaStream();
  Object.defineProperty(stream, "getTracks", {
    value: () => [{ stop: stopTrack }],
  });
  const getUserMedia = mock(() => Promise.resolve(stream));
  const originalMediaDevices = Object.getOwnPropertyDescriptor(
    Navigator.prototype,
    "mediaDevices",
  );
  Object.defineProperty(Navigator.prototype, "mediaDevices", {
    configurable: true,
    get: () => ({ getUserMedia }),
  });
  const play = spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
    function (this: HTMLVideoElement) {
      Object.defineProperties(this, {
        readyState: { configurable: true, value: 4 },
        videoWidth: { configurable: true, value: 320 },
        videoHeight: { configurable: true, value: 320 },
      });
      return Promise.resolve();
    },
  );
  const pause = spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
    () => undefined,
  );
  const drawImage = mock(() => undefined);
  const context = spyOn(
    HTMLCanvasElement.prototype,
    "getContext",
  ).mockReturnValue({
    drawImage,
    getImageData: () => pixels,
  } as unknown as CanvasRenderingContext2D);
  return {
    drawImage,
    getUserMedia,
    play,
    stopTrack,
    stream,
    setCode: (code: string) => {
      pixels = recoveryQrPixels(code);
    },
    restore: () => {
      play.mockRestore();
      pause.mockRestore();
      context.mockRestore();
      if (originalMediaDevices) {
        Object.defineProperty(
          Navigator.prototype,
          "mediaDevices",
          originalMediaDevices,
        );
      } else {
        Reflect.deleteProperty(Navigator.prototype, "mediaDevices");
      }
    },
  };
}

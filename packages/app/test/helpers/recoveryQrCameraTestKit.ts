import { mock, spyOn } from "bun:test";
import encodeQR from "qr";

/** Where a code sits inside a camera frame, in frame pixels. */
export interface RecoveryQrPlacement {
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}

const MODULE_PIXELS = 4;

/**
 * Real QR pixels keep camera tests exercising the production decoder. An
 * unreadable code keeps its finder patterns but scrambles the data between
 * them, so the decoder locates it without reading it, as during focusing.
 * The band starts 12 modules in (border 4, finder 7, separator 1), which
 * leaves data rows only for the short payloads these tests encode. Without a
 * placement the frame is exactly the code; with one, the code sits at
 * (x, y) on a white frame of the given size.
 */
function recoveryQrPixels(
  value: string,
  {
    placement,
    unreadable = false,
  }: {
    placement?: RecoveryQrPlacement;
    unreadable?: boolean;
  } = {},
): ImageData {
  const matrix = encodeQR(value, "raw", { border: 4 });
  const side = matrix.length * MODULE_PIXELS;
  const {
    width,
    height,
    x: left,
    y: top,
  } = placement ?? {
    width: side,
    height: side,
    x: 0,
    y: 0,
  };
  const data = new Uint8ClampedArray(width * height * 4);
  const scrambled = (row: number, column: number) =>
    unreadable &&
    row > 12 &&
    row < matrix.length - 12 &&
    column >= 4 &&
    column < matrix.length - 4 &&
    (row * 3 + column * 7) % 2 === 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const row = Math.floor((y - top) / MODULE_PIXELS);
      const column = Math.floor((x - left) / MODULE_PIXELS);
      const dark = scrambled(row, column) || matrix[row]?.[column];
      const shade = dark ? 0 : 255;
      data[offset] = shade;
      data[offset + 1] = shade;
      data[offset + 2] = shade;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data, colorSpace: "srgb" };
}

/** Pixel width of a test code, for placing it inside a frame. */
export function recoveryQrSide(value: string): number {
  return encodeQR(value, "raw", { border: 4 }).length * MODULE_PIXELS;
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
  // Every copy handed to the scanner, so tests can check what it leaves behind.
  const readFrames: ImageData[] = [];
  const context = spyOn(
    HTMLCanvasElement.prototype,
    "getContext",
  ).mockReturnValue({
    drawImage,
    getImageData: () => {
      const frame = { ...pixels, data: pixels.data.slice() };
      readFrames.push(frame);
      return frame;
    },
  } as unknown as CanvasRenderingContext2D);
  return {
    getUserMedia,
    readFrames,
    play,
    stopTrack,
    stream,
    setCode: (code: string) => {
      pixels = recoveryQrPixels(code);
    },
    setUnreadableCode: (code: string) => {
      pixels = recoveryQrPixels(code, { unreadable: true });
    },
    setCodeInFrame: (code: string, placement: RecoveryQrPlacement) => {
      pixels = recoveryQrPixels(code, { placement });
    },
    clearFrame: () => {
      pixels.data.fill(255);
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

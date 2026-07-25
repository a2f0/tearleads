import { expect, mock, test } from "bun:test";
import type { MediaResult } from "@capacitor/camera";

const EncodingType = { JPEG: 0, PNG: 1 } as const;
const CameraErrorCode = {
  TakePhotoCancelled: "OS-PLUG-CAMR-0006",
} as const;

mock.module("@capacitor/camera", () => ({
  Camera: {},
  CameraErrorCode,
  EncodingType,
}));

const { createCapacitorScanner } = await import("./capacitorScanner");

function cameraResult(
  webPath = "capacitor://localhost/_capacitor_file_/photo.jpg",
): MediaResult {
  return { saved: false, type: 0, webPath };
}

test("captures a bounded JPEG from its web-accessible path", async () => {
  const cameraOptions: unknown[] = [];
  const fetchedPaths: string[] = [];
  const scanner = createCapacitorScanner({
    camera: {
      takePhoto: async (options) => {
        cameraOptions.push(options);
        return cameraResult();
      },
    },
    fetchPhoto: async (input) => {
      fetchedPaths.push(String(input));
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/jpeg" },
      });
    },
  });

  const photo = await scanner.capturePhoto();

  expect(cameraOptions).toEqual([
    {
      correctOrientation: true,
      encodingType: 0,
      quality: 90,
      saveToGallery: false,
      targetHeight: 2048,
      targetWidth: 2048,
    },
  ]);
  expect(fetchedPaths).toEqual([
    "capacitor://localhost/_capacitor_file_/photo.jpg",
  ]);
  if (!photo) {
    throw new Error("Expected the camera photo.");
  }
  expect(photo?.type).toBe("image/jpeg");
  expect([...new Uint8Array(await photo.arrayBuffer())]).toEqual([1, 2, 3]);
});

test("rejects a capture without a web-accessible path", async () => {
  const scanner = createCapacitorScanner({
    camera: { takePhoto: async () => ({ saved: false, type: 0 }) },
  });

  await expect(scanner.capturePhoto()).rejects.toThrow(
    "The camera did not return a web-accessible photo path.",
  );
});

test("rejects a captured photo that cannot be read", async () => {
  const scanner = createCapacitorScanner({
    camera: { takePhoto: async () => cameraResult() },
    fetchPhoto: async () => new Response(null, { status: 404 }),
  });

  await expect(scanner.capturePhoto()).rejects.toThrow(
    "Could not read the captured photo (404).",
  );
});

test("returns null when the native camera is dismissed", async () => {
  const scanner = createCapacitorScanner({
    camera: {
      takePhoto: async () =>
        Promise.reject({
          code: CameraErrorCode.TakePhotoCancelled,
          message: "The camera was canceled.",
        }),
    },
  });

  expect(await scanner.capturePhoto()).toBeNull();
});

test("preserves native camera failures for the calling surface", async () => {
  const failure = Object.assign(new Error("Camera access denied"), {
    code: "OS-PLUG-CAMR-0003",
  });
  const scanner = createCapacitorScanner({
    camera: { takePhoto: async () => Promise.reject(failure) },
  });

  await expect(scanner.capturePhoto()).rejects.toBe(failure);
});

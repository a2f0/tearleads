import { beforeEach, expect, mock, test } from "bun:test";
import type { MediaResult } from "@capacitor/camera";
import { ScannerPhotoCleanupError } from "app/host/AppHostConfig";

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
const deletePhoto = mock(async (_uri: string) => undefined);
beforeEach(() => deletePhoto.mockClear());

function cameraResult(
  webPath = "capacitor://localhost/_capacitor_file_/photo.jpg",
): MediaResult {
  return { saved: false, type: 0, uri: "file:///tmp/photo.jpg", webPath };
}

test("captures a bounded JPEG from its web-accessible path", async () => {
  const cameraOptions: unknown[] = [];
  const fetchedPaths: string[] = [];
  const scanner = createCapacitorScanner({
    deletePhoto,
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
  expect(deletePhoto).toHaveBeenCalledWith("file:///tmp/photo.jpg");
  expect(photo?.type).toBe("image/jpeg");
  expect([...new Uint8Array(await photo.arrayBuffer())]).toEqual([1, 2, 3]);
});

test("rejects a capture without a web-accessible path", async () => {
  const scanner = createCapacitorScanner({
    deletePhoto,
    camera: {
      takePhoto: async () => ({
        saved: false,
        type: 0,
        uri: "file:///tmp/photo.jpg",
      }),
    },
  });

  await expect(scanner.capturePhoto()).rejects.toThrow(
    "The camera did not return a web-accessible photo path.",
  );
});

test("rejects a captured photo that cannot be read", async () => {
  const scanner = createCapacitorScanner({
    deletePhoto,
    camera: { takePhoto: async () => cameraResult() },
    fetchPhoto: async () => new Response(null, { status: 404 }),
  });

  await expect(scanner.capturePhoto()).rejects.toThrow(
    "Could not read the captured photo (404).",
  );
  expect(deletePhoto).toHaveBeenCalledWith("file:///tmp/photo.jpg");
});

test("returns null when the native camera is dismissed", async () => {
  const scanner = createCapacitorScanner({
    deletePhoto,
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
    deletePhoto,
    camera: { takePhoto: async () => Promise.reject(failure) },
  });

  await expect(scanner.capturePhoto()).rejects.toBe(failure);
});

test("deletes the temporary file when fetching or consuming it fails", async () => {
  for (const fetchPhoto of [
    async () => {
      throw new Error("fetch failed");
    },
    async () => {
      const response = new Response();
      Object.defineProperty(response, "blob", {
        value: async () => {
          throw new Error("read failed");
        },
      });
      return response;
    },
  ]) {
    deletePhoto.mockClear();
    const scanner = createCapacitorScanner({
      camera: { takePhoto: async () => cameraResult() },
      deletePhoto,
      fetchPhoto,
    });
    await expect(scanner.capturePhoto()).rejects.toThrow();
    expect(deletePhoto).toHaveBeenCalledWith("file:///tmp/photo.jpg");
  }
});

test("waits for the photo bytes before deleting its file", async () => {
  const pending = Promise.withResolvers<Blob>();
  const reading = Promise.withResolvers<void>();
  const response = new Response();
  Object.defineProperty(response, "blob", {
    value: () => {
      reading.resolve();
      return pending.promise;
    },
  });
  const scanner = createCapacitorScanner({
    camera: { takePhoto: async () => cameraResult() },
    deletePhoto,
    fetchPhoto: async () => response,
  });
  const capture = scanner.capturePhoto();
  await reading.promise;
  expect(deletePhoto).not.toHaveBeenCalled();
  const photo = new Blob(["photo"]);
  pending.resolve(photo);
  expect(await capture).toBe(photo);
  expect(deletePhoto).toHaveBeenCalledTimes(1);
});

test("does not report success when temporary photo deletion fails", async () => {
  const failure = new Error("cleanup failed");
  const scanner = createCapacitorScanner({
    camera: { takePhoto: async () => cameraResult() },
    fetchPhoto: async () => new Response("photo"),
    deletePhoto: async () => {
      throw failure;
    },
  });
  const error = await scanner.capturePhoto().catch((error: unknown) => error);
  expect(error).toBeInstanceOf(ScannerPhotoCleanupError);
  if (!(error instanceof ScannerPhotoCleanupError))
    throw new Error("Expected cleanup failure");
  expect(error.cause).toBe(failure);
  expect(error.message).toContain("remove the temporary camera photo");
});

test("preserves both read and cleanup failures in a distinct cleanup error", async () => {
  const readFailure = new Error("read failed");
  const cleanupFailure = new Error("cleanup failed");
  const scanner = createCapacitorScanner({
    camera: { takePhoto: async () => cameraResult() },
    fetchPhoto: async () => {
      throw readFailure;
    },
    deletePhoto: async () => {
      throw cleanupFailure;
    },
  });
  const error = await scanner.capturePhoto().catch((error: unknown) => error);
  expect(error).toBeInstanceOf(ScannerPhotoCleanupError);
  if (!(error instanceof ScannerPhotoCleanupError))
    throw new Error("Expected cleanup failure");
  expect(error.cause).toBeInstanceOf(AggregateError);
  if (!(error.cause instanceof AggregateError))
    throw new Error("Expected both causes");
  expect(error.cause.errors).toEqual([readFailure, cleanupFailure]);
});

test("rejects a native photo without a removable URI", async () => {
  const scanner = createCapacitorScanner({
    camera: {
      takePhoto: async () => ({ saved: false, type: 0, webPath: "photo.jpg" }),
    },
    deletePhoto,
  });
  await expect(scanner.capturePhoto()).rejects.toThrow("removable photo URI");
  expect(deletePhoto).not.toHaveBeenCalled();
});

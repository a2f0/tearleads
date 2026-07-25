import { expect, test } from "bun:test";
import { EncodingType, type MediaResult } from "@capacitor/camera";
import { createCapacitorScanner } from "./capacitorScanner";

function cameraResult(uri = "file:///camera/photo.jpg"): MediaResult {
  return { saved: false, type: 0, uri };
}

test("captures a JPEG and reads its native temporary URI", async () => {
  const cameraOptions: unknown[] = [];
  const readPaths: string[] = [];
  const scanner = createCapacitorScanner({
    camera: {
      takePhoto: async (options) => {
        cameraOptions.push(options);
        return cameraResult();
      },
    },
    filesystem: {
      readFile: async ({ path }) => {
        readPaths.push(path);
        return { data: "AQID" };
      },
    },
  });

  const photo = await scanner.capturePhoto();

  expect(cameraOptions).toEqual([
    {
      correctOrientation: true,
      encodingType: EncodingType.JPEG,
      quality: 90,
      saveToGallery: false,
    },
  ]);
  expect(readPaths).toEqual(["file:///camera/photo.jpg"]);
  if (!photo) {
    throw new Error("Expected the camera photo.");
  }
  expect(photo?.type).toBe("image/jpeg");
  expect([...new Uint8Array(await photo.arrayBuffer())]).toEqual([1, 2, 3]);
});

test("returns null when the native camera is dismissed", async () => {
  const scanner = createCapacitorScanner({
    camera: {
      takePhoto: async () =>
        Promise.reject({
          code: "OS-PLUG-CAMR-0006",
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

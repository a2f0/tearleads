import { Camera, EncodingType } from "@capacitor/camera";
import { Filesystem } from "@capacitor/filesystem";
import { base64ToBytes } from "@tearleads/encoding";
import type { Scanner } from "app/host/AppHostConfig";

const CAMERA_CANCELLED_CODE = "OS-PLUG-CAMR-0006";

interface CameraBackend {
  takePhoto(
    options: Parameters<typeof Camera.takePhoto>[0],
  ): ReturnType<typeof Camera.takePhoto>;
}

interface FilesystemBackend {
  readFile(
    options: Parameters<typeof Filesystem.readFile>[0],
  ): ReturnType<typeof Filesystem.readFile>;
}

function isCameraCancellation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === CAMERA_CANCELLED_CODE
  );
}

/** Adapts Capacitor's temporary camera URI into the app's Blob-based Scanner. */
export function createCapacitorScanner(
  dependencies: {
    camera?: CameraBackend | undefined;
    filesystem?: FilesystemBackend | undefined;
  } = {},
): Scanner {
  const camera = dependencies.camera ?? Camera;
  const filesystem = dependencies.filesystem ?? Filesystem;

  return {
    async capturePhoto(): Promise<Blob | null> {
      try {
        const result = await camera.takePhoto({
          correctOrientation: true,
          encodingType: EncodingType.JPEG,
          quality: 90,
          saveToGallery: false,
        });
        if (!result.uri) {
          throw new Error("The camera did not return a photo URI.");
        }

        const { data } = await filesystem.readFile({ path: result.uri });
        if (data instanceof Blob) {
          return data.type ? data : new Blob([data], { type: "image/jpeg" });
        }
        return new Blob([new Uint8Array(base64ToBytes(data))], {
          type: "image/jpeg",
        });
      } catch (error) {
        if (isCameraCancellation(error)) {
          return null;
        }
        throw error;
      }
    },
  };
}

import { Camera, CameraErrorCode, EncodingType } from "@capacitor/camera";
import type { Scanner } from "app/host/AppHostConfig";

const CAPTURE_TARGET_SIZE = 2048;

interface CameraBackend {
  takePhoto(
    options: Parameters<typeof Camera.takePhoto>[0],
  ): ReturnType<typeof Camera.takePhoto>;
}

type FetchPhoto = (input: string) => Promise<Response>;

function isCameraCancellation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === CameraErrorCode.TakePhotoCancelled
  );
}

/** Adapts Capacitor's temporary camera URI into the app's Blob-based Scanner. */
export function createCapacitorScanner(
  dependencies: {
    camera?: CameraBackend | undefined;
    fetchPhoto?: FetchPhoto | undefined;
  } = {},
): Scanner {
  const camera = dependencies.camera ?? Camera;
  const fetchPhoto = dependencies.fetchPhoto ?? fetch;

  return {
    async capturePhoto(): Promise<Blob | null> {
      try {
        const result = await camera.takePhoto({
          correctOrientation: true,
          encodingType: EncodingType.JPEG,
          quality: 90,
          saveToGallery: false,
          targetHeight: CAPTURE_TARGET_SIZE,
          targetWidth: CAPTURE_TARGET_SIZE,
        });
        if (!result.webPath) {
          throw new Error(
            "The camera did not return a web-accessible photo path.",
          );
        }

        const response = await fetchPhoto(result.webPath);
        if (!response.ok) {
          throw new Error(
            `Could not read the captured photo (${response.status}).`,
          );
        }
        return response.blob();
      } catch (error) {
        if (isCameraCancellation(error)) {
          return null;
        }
        throw error;
      }
    },
  };
}

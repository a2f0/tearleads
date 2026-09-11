import {
  Camera,
  CameraErrorCode,
  EncodingType,
  type MediaResult,
} from "@capacitor/camera";
import { Filesystem } from "@capacitor/filesystem";
import { type Scanner, ScannerPhotoCleanupError } from "app/host/AppHostConfig";

const CAPTURE_TARGET_SIZE = 2048;

interface CameraBackend {
  takePhoto(
    options: Parameters<typeof Camera.takePhoto>[0],
  ): ReturnType<typeof Camera.takePhoto>;
}

type FetchPhoto = (input: string) => Promise<Response>;

async function readCapturedPhoto(
  result: MediaResult,
  fetchPhoto: FetchPhoto,
): Promise<Blob> {
  if (!result.uri)
    throw new ScannerPhotoCleanupError({
      cause: new Error("The camera did not return a removable photo URI."),
    });
  if (!result.webPath)
    throw new Error("The camera did not return a web-accessible photo path.");
  const response = await fetchPhoto(result.webPath);
  if (!response.ok)
    throw new Error(`Could not read the captured photo (${response.status}).`);
  // Fully consume the file before deleting it, then return only memory.
  return response.blob();
}

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
    deletePhoto?: ((uri: string) => Promise<void>) | undefined;
  } = {},
): Scanner {
  const camera = dependencies.camera ?? Camera;
  const fetchPhoto = dependencies.fetchPhoto ?? fetch;
  // Camera 8 returns a file URL on iOS and an absolute file path on Android.
  // Filesystem accepts both when directory is omitted; do not use webPath here.
  const deletePhoto =
    dependencies.deletePhoto ??
    ((path: string) => Filesystem.deleteFile({ path }));

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
        let readResult: { photo: Blob } | { error: unknown };
        try {
          readResult = { photo: await readCapturedPhoto(result, fetchPhoto) };
        } catch (error) {
          readResult = { error };
        }
        try {
          if (result.uri) await deletePhoto(result.uri);
        } catch (cleanupFailure) {
          throw new ScannerPhotoCleanupError({
            cause:
              "error" in readResult
                ? new AggregateError(
                    [readResult.error, cleanupFailure],
                    "Photo read and cleanup failed.",
                  )
                : cleanupFailure,
          });
        }
        if ("error" in readResult) throw readResult.error;
        return readResult.photo;
      } catch (error) {
        if (isCameraCancellation(error)) {
          return null;
        }
        throw error;
      }
    },
  };
}

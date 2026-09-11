/**
 * A platform camera boundary for capturing images inside native shells.
 *
 * `null` means the user dismissed the camera. Failures such as unavailable
 * hardware or denied permissions reject. A ScannerPhotoCleanupError means
 * capture succeeded but its temporary file could not be removed.
 * Implementations must delete temporary capture files before resolving the
 * Blob; captured images may contain recovery keys or other sensitive data.
 */
export interface Scanner {
  capturePhoto(): Promise<Blob | null>;
}

export type CreateScannerFn = () => Scanner;

export class ScannerPhotoCleanupError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "Could not remove the temporary camera photo from this device.",
      options,
    );
    this.name = "ScannerPhotoCleanupError";
  }
}

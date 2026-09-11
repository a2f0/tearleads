/**
 * A platform camera boundary for capturing images inside native shells.
 *
 * `null` means the user dismissed the camera. Failures such as unavailable
 * hardware or denied permissions reject so the calling surface can explain
 * that no image was captured.
 * Implementations must delete temporary capture files before resolving the
 * Blob; captured images may contain recovery keys or other sensitive data.
 */
export interface Scanner {
  capturePhoto(): Promise<Blob | null>;
}

export type CreateScannerFn = () => Scanner;

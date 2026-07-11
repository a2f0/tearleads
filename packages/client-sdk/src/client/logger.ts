export interface Logger {
  log?: ((message: string) => void) | undefined;
  logError?: ((message: string | Error, cause?: unknown) => void) | undefined;
}

export function logErrorToConsole(
  message: string | Error,
  cause?: unknown,
): void {
  if (cause === undefined) {
    console.error(message);
    return;
  }

  console.error(message, cause);
}

export function logErrorSafely(
  logError: NonNullable<Logger["logError"]>,
  message: string | Error,
  cause?: unknown,
): void {
  try {
    logError(message, cause);
  } catch {
    // Telemetry must not alter the recovery or availability path it describes.
  }
}

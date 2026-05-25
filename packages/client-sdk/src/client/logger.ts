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

/** Verify the existing PIN without changing the host's session or keyring state. */
export type ScreensaverPinVerifier = (
  pin: string,
  signal: AbortSignal,
) => Promise<boolean>;

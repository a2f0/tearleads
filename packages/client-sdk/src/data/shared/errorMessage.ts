/**
 * The one way this package renders an unknown thrown value for a log line or
 * wrapped error message. Classifier code that matches known message strings
 * (and must fail closed on non-Error throwables) should not use this — see
 * isStaleContainerMetadataSecurityStateError and classifyHealBlockedReason.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

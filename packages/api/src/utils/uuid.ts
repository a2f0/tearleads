// Accepts any RFC 4122 version (1–5). Blob/stage ids reaching these routes are
// client-supplied path params validated before use; the broad version range
// matches the original per-route checks this consolidates.
const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export function isUuidString(value: string): boolean {
  return UUID_REGEX.test(value);
}

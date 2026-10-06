/**
 * Response header naming the API build that served the response: the number of
 * commits on the default branch the executable was built from. The default
 * branch only ever gains squash-merged commits, so a later deploy always carries
 * a larger number and clients can compare two values without a lookup table.
 */
export const apiVersionHeaderName = "X-Tearleads-Api-Version";

/** A positive decimal integer without leading zeros, or null for anything else. */
export function parseApiVersion(value: string | null): number | null {
  if (value === null || !/^[1-9]\d*$/u.test(value)) {
    return null;
  }
  const version = Number(value);
  return Number.isSafeInteger(version) ? version : null;
}

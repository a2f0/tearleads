/**
 * Signed timestamps are stored in a `timestamp` column and served back as
 * `Date#toISOString()`. Only the 24-character canonical form with a four-digit
 * year from 1970 through 9999 survives that round trip verbatim: years
 * 0001–0099 are re-read through the two-digit-year pivot, and expanded
 * `±YYYYYY` years are rejected by the column. Honest clients sign `Date.now()`,
 * so nothing outside this range is ever honest data.
 */
export const MIN_SIGNED_AT_YEAR = 1970;
export const MAX_SIGNED_AT_YEAR = 9999;

/** Structural half of the contract; the calendar half needs `Date`. */
export const CANONICAL_SIGNED_AT_PATTERN =
  /^(?:19[7-9]\d|[2-9]\d{3})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const SIGNED_AT_CONTRACT =
  "a canonical ISO-8601 UTC timestamp (YYYY-MM-DDTHH:mm:ss.sssZ) dated 1970-9999";

export function isCanonicalSignedAt(value: string): boolean {
  if (!CANONICAL_SIGNED_AT_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

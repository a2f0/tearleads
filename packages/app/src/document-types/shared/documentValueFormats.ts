/**
 * Conventions for the money and measurement values structured documents keep
 * as strings. An amount is a plain non-negative decimal ("1234.56") stored
 * beside its ISO 4217 currency code, never formatted or converted, so a sum or
 * comparison across currencies is never implied by what is stored.
 */

// Up to three fractional digits, the most any ISO 4217 currency uses.
const AMOUNT_PATTERN = /^\d{1,12}(?:\.\d{1,3})?$/u;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/u;
// A reading such as an odometer: a whole or one-decimal non-negative number.
const READING_PATTERN = /^\d{1,9}(?:\.\d)?$/u;

export const AMOUNT_FORMAT_MESSAGE = "Expected an amount like 1234.56.";
export const CURRENCY_CODE_FORMAT_MESSAGE =
  "Expected a three-letter currency code like USD.";
export const READING_FORMAT_MESSAGE = "Expected a number like 45120.";

export function isValidAmount(value: string): boolean {
  return AMOUNT_PATTERN.test(value.trim());
}

export function isValidCurrencyCode(value: string): boolean {
  return CURRENCY_CODE_PATTERN.test(value.trim());
}

export function isValidReading(value: string): boolean {
  return READING_PATTERN.test(value.trim());
}

/** "120.00 USD" or "45120 mi"; blank when there is no value to qualify. */
export function formatValueWithUnit(value: string, unit: string): string {
  const shown = value.trim();
  if (shown.length === 0) return "";
  const suffix = unit.trim();
  return suffix.length > 0 ? `${shown} ${suffix}` : shown;
}

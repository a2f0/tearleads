import {
  normalizeIdentitySeedPhrase,
  validateIdentitySeedPhrase,
} from "@tearleads/crypto";

export function recoveryKeyScanPhrase(value: string | null): string | null {
  if (
    value === null ||
    value.length > 512 ||
    !validateIdentitySeedPhrase(value)
  )
    return null;
  return normalizeIdentitySeedPhrase(value);
}

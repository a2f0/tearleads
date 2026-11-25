import {
  normalizeIdentitySeedPhrase,
  validateIdentitySeedPhrase,
} from "@tearleads/crypto";

export function recoveryKeyScanPhrase(value: string): string | null {
  if (value.length > 512 || !validateIdentitySeedPhrase(value)) return null;
  return normalizeIdentitySeedPhrase(value);
}

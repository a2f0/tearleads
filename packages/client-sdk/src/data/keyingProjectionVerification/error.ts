import { KeyingVerificationError } from "@tearleads/crypto";

export function throwKeyingVerificationErrorWithContext(
  error: unknown,
  context: string,
): never {
  if (error instanceof KeyingVerificationError) {
    throw new KeyingVerificationError(
      error.code,
      `${context}: ${error.message}`,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`${context}: ${message}`);
}

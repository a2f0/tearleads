import { KeyingVerificationError } from "@tearleads/crypto";
import { errorMessage } from "../errorMessage";

/**
 * Preserve identity and projection verification failures across workflow
 * boundaries that intentionally soften ordinary transport or availability
 * errors. These failures are terminal: retrying or falling back could continue
 * with an untrusted identity.
 */
export function isKeyingVerificationError(error: unknown): boolean {
  return (
    error instanceof KeyingVerificationError ||
    (error instanceof Error && error.name === "KeyingVerificationError")
  );
}

export function rethrowKeyingVerificationError(error: unknown): void {
  if (isKeyingVerificationError(error)) {
    throw error;
  }
}

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
  const message = errorMessage(error);
  throw new Error(`${context}: ${message}`);
}

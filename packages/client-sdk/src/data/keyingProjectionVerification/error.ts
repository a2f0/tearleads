import { KeyingVerificationError } from "@tearleads/crypto";
import { ProjectionDependencyUnavailableError } from "../shared/dependencyUnavailable";
import { errorMessage } from "../shared/errorMessage";
import { isKeyingVerificationError } from "../shared/securityIncidents";
import { isDatabaseUnavailableError } from "../sqlite/availability/databaseUnavailable";
import { rethrowProjectionVerificationCancelled } from "./types";

const KEYING_VERIFICATION_CONTEXT_LIMIT = 16;

/** Use only for synchronous parsing of received protocol material. */
export function readKeyingVerificationShape<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof KeyingVerificationError) throw error;
    throw new KeyingVerificationError("invalid_shape", errorMessage(error));
  }
}

export function rethrowKeyingVerificationError(error: unknown): void {
  if (isKeyingVerificationError(error)) {
    throw error;
  }
}

export function rethrowDatabaseUnavailableError(error: unknown): void {
  if (isDatabaseUnavailableError(error)) {
    throw error;
  }
}

export function rethrowProjectionVerificationBoundaryError(
  error: unknown,
): void {
  rethrowDatabaseUnavailableError(error);
  rethrowProjectionVerificationCancelled(error);
  if (error instanceof ProjectionDependencyUnavailableError) throw error;
}

/**
 * The verification layer reports a shape or hash failure in received protocol
 * material with a plain `Error` (or a `SyntaxError` from decoding its JSON).
 * Anything more specific is not evidence about that material: a boundary error
 * is retryable, a `TypeError` or other typed runtime failure is a defect, and a
 * non-Error value is a foreign throw. Those keep their type so callers can
 * classify them instead of recording them as tampering.
 */
function isReceivedMaterialShapeFailure(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (Object.getPrototypeOf(error) === Error.prototype ||
      error instanceof SyntaxError)
  );
}

/** Classify the failure of an async verification pass; never returns. */
export function throwKeyingVerificationShapeFailure(error: unknown): never {
  rethrowProjectionVerificationBoundaryError(error);
  if (
    isKeyingVerificationError(error) ||
    !isReceivedMaterialShapeFailure(error)
  )
    throw error;
  throw new KeyingVerificationError("invalid_shape", error.message);
}

export function throwKeyingVerificationErrorWithContext(
  error: unknown,
  context: string,
): never {
  // Availability and cancellation keep their retryable types across contexts.
  rethrowProjectionVerificationBoundaryError(error);
  if (isKeyingVerificationError(error)) {
    // Preserve identity so nested reporting boundaries persist one incident.
    // The incident's operation supplies boundary context without minting a new
    // verification error that could bypass identity-based deduplication. Keep
    // the boundary labels non-enumerably for host-side diagnostics.
    try {
      const previous = Reflect.get(error, "keyingVerificationContexts");
      const contexts = Array.isArray(previous)
        ? [...previous, context].slice(-KEYING_VERIFICATION_CONTEXT_LIMIT)
        : [context];
      Object.defineProperty(error, "keyingVerificationContexts", {
        configurable: true,
        enumerable: false,
        value: contexts,
      });
    } catch {
      // A frozen foreign error still preserves its identity and code.
    }
    throw error;
  }
  const message = errorMessage(error);
  throw new Error(`${context}: ${message}`);
}

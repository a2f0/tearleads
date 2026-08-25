import { KeyingVerificationError } from "@symcrypt/crypto";
import { errorMessage } from "../errorMessage";
import type {
  SecurityIncidentContext,
  SecurityIncidentReporter,
} from "../securityIncidents";
import { isDatabaseUnavailableError } from "../sync/databaseUnavailable";

const KEYING_VERIFICATION_CONTEXT_LIMIT = 16;
const KEYING_VERIFICATION_CAUSE_LIMIT = 16;

/**
 * Preserve identity and projection verification failures across workflow
 * boundaries that intentionally soften ordinary transport or availability
 * errors. These failures are terminal: retrying or falling back could continue
 * with an untrusted identity.
 */
export function isKeyingVerificationError(
  error: unknown,
): error is Error & { readonly code?: unknown } {
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

function keyingVerificationErrorInCauseChain(
  error: unknown,
): (Error & { readonly code?: unknown }) | null {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < KEYING_VERIFICATION_CAUSE_LIMIT; depth += 1) {
    if (isKeyingVerificationError(current)) return current;
    if (!(current instanceof Error) || seen.has(current)) return null;
    seen.add(current);
    current = current.cause;
  }
  return null;
}

/**
 * Persist a terminal integrity failure before preserving the boundary error.
 * Call only outside an open persistence transaction: the reporter serializes
 * its own write and awaiting it from that transaction would deadlock.
 */
export async function reportAndRethrowKeyingVerificationError(
  error: unknown,
  reporter: SecurityIncidentReporter | undefined,
  context: SecurityIncidentContext,
): Promise<void> {
  const verificationError = keyingVerificationErrorInCauseChain(error);
  if (!verificationError) return;
  try {
    await reporter?.(verificationError, context);
  } catch {
    // Incident reporting is best-effort at this boundary. It must never replace
    // the boundary error that stopped use of untrusted data.
  }
  throw error;
}

export async function runWithSecurityIncidentReporting<T>(
  reporter: SecurityIncidentReporter | undefined,
  context: SecurityIncidentContext,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    await reportAndRethrowKeyingVerificationError(error, reporter, context);
    throw error;
  }
}

export function rethrowDatabaseUnavailableError(error: unknown): void {
  if (isDatabaseUnavailableError(error)) {
    throw error;
  }
}

export function throwKeyingVerificationErrorWithContext(
  error: unknown,
  context: string,
): never {
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

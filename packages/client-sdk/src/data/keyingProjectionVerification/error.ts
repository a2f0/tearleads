import { KeyingVerificationError } from "@tearleads/crypto";
import { errorMessage } from "../errorMessage";
import type {
  SecurityIncidentContext,
  SecurityIncidentReporter,
} from "../securityIncidents";
import { isDatabaseUnavailableError } from "../sync/databaseUnavailable";
import { rethrowProjectionVerificationCancelled } from "./types";

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

/**
 * A served head newer than the local checkpoint, signed by a member with no
 * current authority, that cites a stale ancestor head. The device cannot tell
 * that member's last honest event from one committed later with the server's
 * help, so the head is not used; a later event on the container by a member
 * with current authority supersedes it, and no fresh projection resolves it.
 * Boundaries record it and defer rather than fail.
 */
function isStaleCitationError(error: unknown): boolean {
  return isKeyingVerificationError(error) && error.code === "stale_citation";
}

/** Whether a stale citation is the verification failure in the cause chain. */
export function isStaleCitationInCauseChain(error: unknown): boolean {
  return isStaleCitationError(keyingVerificationErrorInCauseChain(error));
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
 * True when the cause chain holds a keying verification error; callers use
 * the result to preserve the boundary. Reporting is best-effort.
 */
export async function reportKeyingVerificationErrorInCauseChain(
  error: unknown,
  reporter: SecurityIncidentReporter | undefined,
  context: SecurityIncidentContext,
): Promise<boolean> {
  const verificationError = keyingVerificationErrorInCauseChain(error);
  if (!verificationError) return false;
  try {
    await reporter?.(verificationError, context);
  } catch {
    // Incident reporting is best-effort at this boundary. It must never replace
    // the boundary behavior that stopped use of untrusted data.
  }
  return true;
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
  const reported = await reportKeyingVerificationErrorInCauseChain(
    error,
    reporter,
    context,
  );
  if (!reported) return;
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

export function rethrowProjectionVerificationBoundaryError(
  error: unknown,
): void {
  rethrowDatabaseUnavailableError(error);
  rethrowProjectionVerificationCancelled(error);
}

export function throwKeyingVerificationErrorWithContext(
  error: unknown,
  context: string,
): never {
  rethrowProjectionVerificationCancelled(error);
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

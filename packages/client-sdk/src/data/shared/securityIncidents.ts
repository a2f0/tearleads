import {
  type KeyingVerificationCode,
  KeyingVerificationError,
} from "@tearleads/crypto";

const KEYING_VERIFICATION_CAUSE_LIMIT = 16;

export type SecurityIncidentObjectKind =
  | "blob"
  | "container"
  | "document"
  | "principal"
  | "user"
  | "unknown";

export interface SecurityIncident {
  readonly id: string;
  readonly trustDomain: string | null;
  readonly code: KeyingVerificationCode | "unrecognized_verification_code";
  readonly operation: string;
  readonly objectKind: SecurityIncidentObjectKind;
  readonly objectId: string | null;
  readonly organizationId: string | null;
  readonly evidenceHashes: Readonly<Record<string, string>>;
  /** Timestamp of the first equivalent detection. */
  readonly detectedAt: string;
  /** Timestamp of the most recent equivalent detection. */
  readonly lastDetectedAt: string;
  readonly occurrenceCount: number;
}

export interface SecurityIncidentContext {
  readonly operation: string;
  readonly objectKind: SecurityIncidentObjectKind;
  readonly objectId: string | null;
  readonly organizationId?: string | null | undefined;
  /** Protocol hashes only. Never pass plaintext, ciphertext, or error text. */
  readonly evidenceHashes?: Readonly<Record<string, string>> | undefined;
}

export type SecurityIncidentReporter = (
  error: unknown,
  context: SecurityIncidentContext,
) => Promise<void>;

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

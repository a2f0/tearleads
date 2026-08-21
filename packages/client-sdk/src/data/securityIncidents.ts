import type { KeyingVerificationCode } from "@symcrypt/crypto";

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

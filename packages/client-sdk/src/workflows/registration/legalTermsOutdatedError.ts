import { LEGAL_TERMS_OUTDATED_ERROR_CODE } from "@tearleads/validators/legalTerms";
import { registerOperation } from "@tearleads/validators/operation";

/** A failed registration request, as the API client records it. */
export interface RegistrationRequestFailure {
  readonly code?: string | undefined;
  readonly kind: string;
  readonly status: number | null;
}

/** The key the API client records a failed registration under. */
export const REGISTRATION_REQUEST = {
  method: registerOperation.method,
  path: registerOperation.path,
} as const;

/**
 * The API refused a registration because the legal terms revision it carried
 * is no longer the current one: the client showed its user an earlier
 * revision. Nothing was registered; once the client shows the current
 * revision (an installed app, by updating) and its user agrees, registering
 * again can succeed.
 */
export class LegalTermsOutdatedError extends Error {
  constructor(readonly acceptedLegalTermsVersion: string) {
    super(
      `The Privacy Policy and Terms of Service have changed since the revision of ${acceptedLegalTermsVersion} that this client shows. Update it to review and agree to the current revision, then register again.`,
    );
    this.name = "LegalTermsOutdatedError";
  }
}

/**
 * Whether the failure a registration just recorded is the API's refusal of
 * its legal terms revision. The client records each failure as a new
 * object, so one unchanged since before the request is not this request's.
 */
export function isLegalTermsOutdatedFailure(
  failure: RegistrationRequestFailure | null,
  earlier: RegistrationRequestFailure | null,
): boolean {
  return (
    failure !== null &&
    failure !== earlier &&
    failure.kind === "http" &&
    failure.status === 409 &&
    failure.code === LEGAL_TERMS_OUTDATED_ERROR_CODE
  );
}

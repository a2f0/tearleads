import { throwPrincipalPolicyValidationError as rejectPrincipalPolicy } from "@tearleads/crypto";

/** Why a principal-state signer may sign; anything else is rejected. */
export type PrincipalSignerAuthority = "direct-admin" | "external-admin";

/**
 * Decides the signer's authority. A direct admin of the governing projection
 * never cites external authority and never consults the external
 * authorizer; any other signer is authorized only when the state cites
 * external authority, `mayUseExternalAuthority` holds, and the authorizer
 * says yes.
 */
export async function authorizePrincipalStateSigner(input: {
  readonly isDirectAdmin: boolean;
  readonly citesExternalAuthority: boolean;
  readonly mayUseExternalAuthority: boolean;
  readonly authorizeExternalAdmin: (() => Promise<boolean>) | undefined;
}): Promise<PrincipalSignerAuthority> {
  if (input.isDirectAdmin) {
    if (input.citesExternalAuthority) {
      rejectPrincipalPolicy(
        "unauthorized_signer",
        "Directly authorized principal state cannot cite external authority",
      );
    }
    return "direct-admin";
  }
  if (
    input.citesExternalAuthority &&
    input.mayUseExternalAuthority &&
    input.authorizeExternalAdmin &&
    (await input.authorizeExternalAdmin())
  ) {
    return "external-admin";
  }
  return rejectPrincipalPolicy(
    "unauthorized_signer",
    "Principal state signer must be an admin",
  );
}

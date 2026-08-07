export type PrincipalPolicyValidationErrorCode =
  | "invalid_artifact"
  | "missing_state"
  | "state_conflict"
  | "unauthorized_signer";

export class PrincipalPolicyValidationError extends Error {
  constructor(
    readonly code: PrincipalPolicyValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PrincipalPolicyValidationError";
  }
}

export function throwPrincipalPolicyValidationError(
  code: PrincipalPolicyValidationErrorCode,
  message: string,
): never {
  throw new PrincipalPolicyValidationError(code, message);
}

import { KeyingVerificationError } from "@tearleads/crypto";
import { DocumentKekTargetError } from "../../../access/read/documentKekTargets";
import { DocumentContentKeyBundleError } from "../../../access/write/documentContentKeyStore";
import { DocumentUpdateReadError } from "../../../documents/documentUpdateStore";
import { ContainerMutationError } from "../../containers/mutations";
import { PrincipalPolicyProjectionError } from "../../principals/principalPolicyProjection";

type DocumentMutationStatus = 400 | 403 | 404 | 409 | 503;

export class DocumentMutationError extends Error {
  constructor(
    message: string,
    readonly status: DocumentMutationStatus,
  ) {
    super(message);
    this.name = "DocumentMutationError";
  }
}

export function documentShapeError(message: string): DocumentMutationError {
  return new DocumentMutationError(message, 400);
}

function mapVerificationStatus(
  error: KeyingVerificationError,
): DocumentMutationStatus {
  if (
    error.code === "signature_mismatch" ||
    error.code === "signer_mismatch" ||
    error.code === "unauthorized"
  ) {
    return 403;
  }

  if (
    error.code === "invalid_domain" ||
    error.code === "invalid_shape" ||
    error.code === "object_mismatch"
  ) {
    return 400;
  }

  return 409;
}

export function toMutationError(error: unknown): DocumentMutationError | null {
  if (error instanceof DocumentMutationError) {
    return error;
  }

  if (error instanceof DocumentContentKeyBundleError) {
    return new DocumentMutationError(error.message, error.status);
  }

  if (error instanceof DocumentUpdateReadError) {
    return new DocumentMutationError(error.message, error.status);
  }

  if (error instanceof DocumentKekTargetError) {
    return new DocumentMutationError(error.message, error.status);
  }

  if (error instanceof PrincipalPolicyProjectionError) {
    return new DocumentMutationError(error.message, error.status);
  }

  if (error instanceof ContainerMutationError) {
    return new DocumentMutationError(error.message, error.status);
  }

  if (error instanceof KeyingVerificationError) {
    return new DocumentMutationError(
      error.message,
      mapVerificationStatus(error),
    );
  }

  return null;
}

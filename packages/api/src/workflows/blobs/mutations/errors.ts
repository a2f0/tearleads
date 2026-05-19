import { KeyingVerificationError } from "@tearleads/crypto";
import { BlobKekTargetError } from "../../../access/read/blobKekTargets";
import { BlobContentKeyBundleError } from "../../../access/write/blobContentKeyStore";
import { ContainerMutationError } from "../../containers/mutations";
import { DocumentMutationError } from "../../documents/mutations";
import { PrincipalPolicyProjectionError } from "../../principals/principalPolicyProjection";
import { BlobMutationError, type BlobMutationStatus } from "./types";

function mapVerificationStatus(
  error: KeyingVerificationError,
): BlobMutationStatus {
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

export function toMutationError(error: unknown): BlobMutationError | null {
  if (error instanceof BlobMutationError) {
    return error;
  }

  if (error instanceof DocumentMutationError) {
    return new BlobMutationError(error.message, error.status);
  }

  if (error instanceof ContainerMutationError) {
    return new BlobMutationError(error.message, error.status);
  }

  if (error instanceof PrincipalPolicyProjectionError) {
    return new BlobMutationError(error.message, error.status);
  }

  if (error instanceof BlobContentKeyBundleError) {
    return new BlobMutationError(error.message, error.status);
  }

  if (error instanceof BlobKekTargetError) {
    return new BlobMutationError(error.message, error.status);
  }

  if (error instanceof KeyingVerificationError) {
    return new BlobMutationError(error.message, mapVerificationStatus(error));
  }

  return null;
}

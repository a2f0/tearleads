import { KeyingVerificationError } from "@symcrypt/crypto";
import { BlobKekTargetError } from "../../../access/read/blobKekTargets";
import { BlobContentKeyBundleError } from "../../../access/write/blobContentKeyStore";
import { keyingVerificationHttpStatus } from "../../../keyingProjectionRecords";
import { ContainerMutationError } from "../../containers/mutations";
import { DocumentMutationError } from "../../documents/mutations";
import { PrincipalPolicyProjectionError } from "../../principals/principalPolicyProjection";
import { BlobMutationError } from "./types";

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
    return new BlobMutationError(
      error.message,
      keyingVerificationHttpStatus(error),
    );
  }

  return null;
}

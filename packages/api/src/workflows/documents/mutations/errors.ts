import { KeyingVerificationError } from "@symcrypt/crypto";
import {
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  DOCUMENT_SYNC_ERROR_CODES,
  type DocumentNotFoundErrorCode,
  type DocumentSyncErrorCode,
} from "@symcrypt/validators/response";
import { DocumentKekTargetError } from "../../../access/read/documentKekTargets";
import { DocumentContentKeyBundleError } from "../../../access/write/documentContentKeyStore";
import { DocumentUpdateReadError } from "../../../documents/documentUpdateStore";
import { keyingVerificationHttpStatus } from "../../../keyingProjectionRecords";
import {
  isLibsqlTransactionContention,
  isSerializationFailure,
  isUniqueViolation,
} from "../../../utils/databaseErrors";
import { ContainerMutationError } from "../../containers/mutations";
import { ContainerWriterProjectionError } from "../../containers/writerProjection/types";
import { PrincipalPolicyProjectionError } from "../../principals/principalPolicyProjection";

type DocumentMutationStatus = 400 | 403 | 404 | 409 | 503;

type DocumentMutationErrorCode =
  | DocumentSyncErrorCode
  | DocumentNotFoundErrorCode;

export class DocumentMutationError extends Error {
  constructor(
    message: string,
    readonly status: DocumentMutationStatus,
    readonly code?: DocumentMutationErrorCode | undefined,
  ) {
    super(message);
    this.name = "DocumentMutationError";
  }
}

export function documentShapeError(message: string): DocumentMutationError {
  return new DocumentMutationError(message, 400);
}

export function documentSyncStateStale(message: string): DocumentMutationError {
  return new DocumentMutationError(
    message,
    409,
    DOCUMENT_SYNC_ERROR_CODES.stateStale,
  );
}

export function documentUpdateIdConflict(): DocumentMutationError {
  return new DocumentMutationError(
    "Document update id conflict",
    409,
    DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
  );
}

/**
 * The positively-verified "this document does not exist" failure. Clients
 * answer this code with a destructive local teardown, so it may only be thrown
 * after a direct existence check of the `documents` row — never for a missing
 * head, bundle, or container, which can also 404 without the document being
 * deleted.
 */
export function documentNotFound(): DocumentMutationError {
  return new DocumentMutationError(
    "Document not found",
    404,
    DOCUMENT_NOT_FOUND_ERROR_CODE,
  );
}

/**
 * Only documentNotFound() may reach the wire as a 404 on document routes —
 * clients answer that coded 404 with a destructive local teardown. A 404 from
 * a store lookup (missing head, bundle, or target) is not proof of deletion,
 * so it degrades to 409.
 */
function nonWipeStatus<Status extends number>(status: Status): Status | 409 {
  return status === 404 ? 409 : status;
}

export function toMutationError(error: unknown): DocumentMutationError | null {
  if (error instanceof DocumentMutationError) {
    return error;
  }

  if (error instanceof DocumentContentKeyBundleError) {
    return new DocumentMutationError(
      error.message,
      nonWipeStatus(error.status),
      error.code,
    );
  }

  if (error instanceof DocumentUpdateReadError) {
    return new DocumentMutationError(error.message, error.status);
  }

  if (error instanceof DocumentKekTargetError) {
    return new DocumentMutationError(
      error.message,
      nonWipeStatus(error.status),
      error.code,
    );
  }

  if (error instanceof PrincipalPolicyProjectionError) {
    return new DocumentMutationError(error.message, error.status);
  }

  if (error instanceof ContainerMutationError) {
    return new DocumentMutationError(
      error.message,
      nonWipeStatus(error.status),
    );
  }

  if (error instanceof ContainerWriterProjectionError) {
    return new DocumentMutationError(
      error.message,
      nonWipeStatus(error.status),
    );
  }

  if (error instanceof KeyingVerificationError) {
    return new DocumentMutationError(
      error.message,
      keyingVerificationHttpStatus(error),
    );
  }

  if (isUniqueViolation(error)) {
    // A unique violation that survives the explicit existence checks means a
    // concurrent request committed the same row between our read and write.
    // Surface it as a conflict rather than letting the driver error 500.
    return new DocumentMutationError("Document sync write conflict", 409);
  }

  if (isLibsqlTransactionContention(error)) {
    return documentSyncStateStale(
      "Document mutation transaction conflicted; retry",
    );
  }

  if (isSerializationFailure(error)) {
    // Deadlock detection / serialization failure: the losing transaction was
    // rolled back by the database and a retry is expected to succeed.
    return new DocumentMutationError(
      "Document mutation transaction conflicted; retry",
      503,
    );
  }

  return null;
}

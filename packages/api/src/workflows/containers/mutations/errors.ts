import { KeyingVerificationError } from "@symcrypt/crypto";
import type { PrincipalPolicyStaleErrorResponse } from "@symcrypt/validators/response";
import { keyingVerificationHttpStatus } from "../../../keyingProjectionRecords";
import {
  errorCauseChain,
  isLibsqlTransactionContention,
  isLockContention,
  isSerializationFailure,
  isUniqueViolation,
} from "../../../utils/databaseErrors";
import type { ContainerMutationStatus } from "./types";

type ContainerMutationErrorBody =
  | { readonly error: string }
  | PrincipalPolicyStaleErrorResponse;

export class ContainerMutationError extends Error {
  constructor(
    message: string,
    readonly status: ContainerMutationStatus,
    readonly body?: ContainerMutationErrorBody | undefined,
  ) {
    super(message);
    this.name = "ContainerMutationError";
  }
}

export function mutationShapeError(message: string): ContainerMutationError {
  return new ContainerMutationError(message, 400);
}

export function toMutationError(error: unknown): ContainerMutationError | null {
  if (error instanceof ContainerMutationError) {
    return error;
  }

  if (error instanceof KeyingVerificationError) {
    return new ContainerMutationError(
      error.message,
      keyingVerificationHttpStatus(error),
    );
  }

  if (isLibsqlTransactionContention(error)) {
    return new ContainerMutationError(
      "Container mutation transaction conflicted; retry",
      409,
    );
  }

  return null;
}

const PREDECESSOR_SUCCESSOR_CONSTRAINT = "container_key_epochs_predecessor_idx";
const SQLITE_PREDECESSOR_SUCCESSOR_CONSTRAINT =
  "UNIQUE constraint failed: container_key_epochs.predecessor_container_key_epoch_id";

function hasPredecessorSuccessorConstraint(error: unknown): boolean {
  return errorCauseChain(error).some(
    (candidate) =>
      Reflect.get(candidate, "constraint") ===
        PREDECESSOR_SUCCESSOR_CONSTRAINT ||
      candidate.message === SQLITE_PREDECESSOR_SUCCESSOR_CONSTRAINT,
  );
}

/**
 * Converts concurrent-write database failures (unique-constraint races,
 * serialization failures, lock contention) into retriable 409s. Anything
 * unclassified is a programming error and propagates to the 500 handler.
 */
export async function runConflictBoundary<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof ContainerMutationError ||
      error instanceof KeyingVerificationError
    ) {
      throw error;
    }

    if (hasPredecessorSuccessorConstraint(error)) {
      throw new ContainerMutationError(
        "Container KEK predecessor already has a successor",
        409,
      );
    }

    if (
      isUniqueViolation(error) ||
      isLibsqlTransactionContention(error) ||
      isSerializationFailure(error) ||
      isLockContention(error)
    ) {
      throw new ContainerMutationError(
        error instanceof Error ? error.message : String(error),
        409,
      );
    }

    throw error;
  }
}

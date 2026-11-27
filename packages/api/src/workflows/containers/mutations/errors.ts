import { KeyingVerificationError } from "@tearleads/crypto";
import {
  CONTAINER_MUTATION_ERROR_CODES,
  type ContainerMutationFailureResponse,
  type PrincipalPolicyStaleErrorResponse,
} from "@tearleads/validators/response";
import { keyingVerificationHttpStatus } from "../../../keyingProjectionRecords";
import {
  errorCauseChain,
  isSerializationFailure,
  isUniqueViolation,
} from "../../../utils/databaseErrors";
import { ContainerWriterProjectionError } from "../writerProjection/types";
import type { ContainerMutationStatus } from "./types";

type ContainerMutationErrorBody =
  | ContainerMutationFailureResponse
  | PrincipalPolicyStaleErrorResponse;

type ContainerMutationErrorRecovery = "state_stale";

export class ContainerMutationError extends Error {
  constructor(
    message: string,
    readonly status: ContainerMutationStatus,
    readonly body?: ContainerMutationErrorBody | undefined,
    readonly recovery?: ContainerMutationErrorRecovery | undefined,
  ) {
    super(message);
    this.name = "ContainerMutationError";
  }
}

export function mutationStateStale(
  message: string,
  body?: ContainerMutationErrorBody,
): ContainerMutationError {
  return new ContainerMutationError(
    message,
    409,
    body ?? {
      code: CONTAINER_MUTATION_ERROR_CODES.stateStale,
      error: message,
    },
    "state_stale",
  );
}

export function containerManifestAlreadyExists(): ContainerMutationError {
  const message = "Container manifest already exists";
  return new ContainerMutationError(message, 409, {
    code: CONTAINER_MUTATION_ERROR_CODES.manifestAlreadyExists,
    error: message,
  });
}

/**
 * A cited path element's `containers` row is gone (deleted; the manifest head
 * is retained for history). Coded so clients can tell this permanent
 * condition from a transient conflict.
 */
export function containerUnavailable(label: string): ContainerMutationError {
  const message = `${label} container unavailable`;
  return new ContainerMutationError(message, 409, {
    code: CONTAINER_MUTATION_ERROR_CODES.containerUnavailable,
    error: message,
  });
}

/**
 * A create or move would leave a path longer than readers accept. Coded so a
 * client can tell the same request never succeeds: it abandons a queued move
 * and keeps a queued create until a local move re-arms it.
 */
export function containerPathTooDeep(): ContainerMutationError {
  const message = "Container path exceeds maximum depth";
  return new ContainerMutationError(message, 409, {
    code: CONTAINER_MUTATION_ERROR_CODES.pathTooDeep,
    error: message,
  });
}

/**
 * A rotation would leave `requiredContainerIds` (parent-first) pinned to a
 * retired epoch above a directly granted container. Not `state_stale`:
 * refetching cannot help, the client must sign and carry those re-keys.
 */
export function descendantRekeysRequired(
  requiredContainerIds: readonly string[],
): ContainerMutationError {
  const message = "Container rotation must carry its descendant rekeys";
  return new ContainerMutationError(message, 409, {
    code: CONTAINER_MUTATION_ERROR_CODES.descendantRekeysRequired,
    error: message,
    requiredContainerIds: [...requiredContainerIds],
  });
}

/**
 * A container's first direct grant sits below a chain pinned to a retired
 * epoch. Its grantee could never re-key those levels, so the sharer does first.
 * Not `state_stale`, for the same reason as above. The message names the stale
 * level; the sharer's own projection shows the rest of the chain.
 */
export function ancestorRekeysRequired(
  message: string,
): ContainerMutationError {
  return new ContainerMutationError(message, 409, {
    code: CONTAINER_MUTATION_ERROR_CODES.ancestorRekeysRequired,
    error: message,
  });
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

  // Writer-projection work a mutation runs, such as stored-history
  // verification for its write-time marking and the citations its KEK check
  // reads. A missing stored row is no proof the container is gone, so it never
  // reaches the client as a 404.
  if (error instanceof ContainerWriterProjectionError) {
    return new ContainerMutationError(
      error.message,
      error.status === 404 ? 409 : error.status,
    );
  }

  return null;
}

const PREDECESSOR_SUCCESSOR_CONSTRAINT = "container_key_epochs_predecessor_idx";
const SYSTEM_SLOT_CONSTRAINT = "containers_org_system_slot_idx";

function hasConstraint(error: unknown, constraint: string): boolean {
  return errorCauseChain(error).some(
    (candidate) => Reflect.get(candidate, "constraint") === constraint,
  );
}

/**
 * The organization already holds a container in the create's system slot.
 * Uncoded, so a client that does not read the flag treats it as final rather
 * than replanning against fresh heads: the same create never succeeds, and the
 * client folds its copy into the listed one instead.
 */
export function containerSystemSlotTaken(): ContainerMutationError {
  const message = "Container system slot is already taken";
  return new ContainerMutationError(message, 409, {
    error: message,
    systemSlotTaken: true,
  });
}

/**
 * Converts concurrent-write database failures (unique-constraint races,
 * serialization failures, deadlocks) into retriable 409s. Anything
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

    if (hasConstraint(error, PREDECESSOR_SUCCESSOR_CONSTRAINT)) {
      throw mutationStateStale(
        "Container KEK predecessor already has a successor",
      );
    }

    if (
      isUniqueViolation(error) &&
      hasConstraint(error, SYSTEM_SLOT_CONSTRAINT)
    ) {
      throw containerSystemSlotTaken();
    }

    // A driver message names the statement and its parameters, so a client
    // gets a fixed one.
    if (isUniqueViolation(error) || isSerializationFailure(error)) {
      throw mutationStateStale("Container state changed concurrently");
    }

    throw error;
  }
}

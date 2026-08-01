import { KeyingVerificationError } from "@tearleads/crypto";
import type { PrincipalPolicyStaleErrorResponse } from "@tearleads/validators/response";
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

function mapVerificationStatus(
  error: KeyingVerificationError,
): ContainerMutationStatus {
  if (
    error.code === "signature_mismatch" ||
    error.code === "signer_mismatch" ||
    error.code === "unauthorized"
  ) {
    return 403;
  }

  if (error.code === "invalid_domain" || error.code === "invalid_shape") {
    return 400;
  }

  if (error.code === "object_mismatch") {
    return 400;
  }

  return 409;
}

export function toMutationError(error: unknown): ContainerMutationError | null {
  if (error instanceof ContainerMutationError) {
    return error;
  }

  if (error instanceof KeyingVerificationError) {
    return new ContainerMutationError(
      error.message,
      mapVerificationStatus(error),
    );
  }

  return null;
}

const PREDECESSOR_SUCCESSOR_CONSTRAINT = "container_key_epochs_predecessor_idx";

function hasConstraint(error: unknown, constraint: string): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current !== null; depth += 1) {
    if (typeof current !== "object") {
      return false;
    }
    if (Reflect.get(current, "constraint") === constraint) {
      return true;
    }
    const message = Reflect.get(current, "message");
    if (typeof message === "string" && message.includes(constraint)) {
      return true;
    }
    current = Reflect.get(current, "cause");
  }
  return false;
}

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
      throw new ContainerMutationError(
        "Container KEK predecessor already has a successor",
        409,
      );
    }

    throw new ContainerMutationError(
      error instanceof Error ? error.message : String(error),
      409,
    );
  }
}

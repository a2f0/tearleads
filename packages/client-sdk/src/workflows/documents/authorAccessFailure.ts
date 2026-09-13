import { ContainerAuthorAccessError } from "../../data/containers/shared/authorAccess";
import type { DocumentCreateTerminalFailureHandler } from "./createProjectionFetch";

/** A verified read-only path is a local permission refusal, not tampered proof. */
export async function recordDocumentAuthorAccessFailure<T>(
  build: () => Promise<T>,
  onFailure: DocumentCreateTerminalFailureHandler | undefined,
): Promise<T | null> {
  try {
    return await build();
  } catch (error) {
    if (!(error instanceof ContainerAuthorAccessError)) throw error;
    await onFailure?.({ message: error.message, status: error.status });
    return null;
  }
}

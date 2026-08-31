import type { StaleRootRecoveryStatus } from "../../workflows/container-contents/staleRootRecovery";

interface ContainerDocumentWorkInput {
  readonly isCurrent: () => boolean;
  readonly onContextChanged: () => void;
  readonly onDocumentsMoved: () => void;
  readonly primeDocuments: () => Promise<void>;
  readonly recoverStaleRoot: () => Promise<StaleRootRecoveryStatus>;
  readonly shouldPrimeDocuments: () => boolean;
  readonly syncPendingDocumentMoves: () => Promise<number>;
}

/** Runs root repair before any work that consumes its rewritten projections. */
export async function runContainerDocumentWork(
  input: ContainerDocumentWorkInput,
): Promise<"abandoned" | "completed" | "context-changed"> {
  if (!input.isCurrent()) {
    return "abandoned";
  }
  const recoveryStatus = await input.recoverStaleRoot();
  if (!input.isCurrent()) {
    return "abandoned";
  }
  if (recoveryStatus === "context-changed") {
    input.onContextChanged();
    return "context-changed";
  }

  const movedDocumentCount = await input.syncPendingDocumentMoves();
  if (!input.isCurrent()) {
    return "abandoned";
  }
  if (movedDocumentCount > 0) {
    input.onDocumentsMoved();
  }
  if (input.shouldPrimeDocuments()) {
    await input.primeDocuments();
    if (!input.isCurrent()) {
      return "abandoned";
    }
  }
  return "completed";
}

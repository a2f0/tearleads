import type { StaleRootRecoveryStatus } from "../../workflows/container-contents/staleRootRecovery";

interface ContainerDocumentWorkInput {
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
): Promise<"completed" | "context-changed"> {
  if ((await input.recoverStaleRoot()) === "context-changed") {
    input.onContextChanged();
    return "context-changed";
  }

  const movedDocumentCount = await input.syncPendingDocumentMoves();
  if (movedDocumentCount > 0) {
    input.onDocumentsMoved();
  }
  if (input.shouldPrimeDocuments()) {
    await input.primeDocuments();
  }
  return "completed";
}

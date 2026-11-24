import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { documentUpdateSpans } from "@tearleads/api-shared/schema";
import { listVersionVectorSpans } from "@tearleads/loro";
import { chunkDocumentPeerRows } from "./documentPeerRowChunks";

interface DocumentUpdateSpanSource {
  id: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
}

export async function insertDocumentUpdateSpans(
  executor: DatabaseSession,
  input: {
    documentId: string;
    updates: ReadonlyArray<DocumentUpdateSpanSource>;
  },
): Promise<void> {
  const rows = input.updates.flatMap((update) =>
    listVersionVectorSpans({
      partialStartVersionVector: update.partialStartVersionVector,
      partialEndVersionVector: update.partialEndVersionVector,
    }).map((span) => ({
      documentId: input.documentId,
      updateId: update.id,
      peerId: span.peerId,
      startCounter: span.startCounter,
      endCounter: span.endCounter,
    })),
  );

  // One update may declare as many peers as the request's bytes admit, more
  // than one statement can bind, so the rows go in chunks within the
  // caller's transaction.
  for (const chunk of chunkDocumentPeerRows(rows)) {
    await executor.insert(documentUpdateSpans).values(chunk);
  }
}

import { listVersionVectorSpans } from "@tearleads/loro";
import type { DatabaseSession } from "../adapters/postgres";
import { documentUpdateSpans } from "../schema";

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

  if (rows.length === 0) {
    return;
  }

  await executor.insert(documentUpdateSpans).values(rows);
}

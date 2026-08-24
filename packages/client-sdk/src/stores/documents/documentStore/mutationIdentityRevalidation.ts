import { persistDocument } from "./persistence";
import type { DocumentState, DocumentStoreState } from "./state";
import type { DocumentStoreSyncGeneration } from "./syncGeneration";

export async function revalidateDocumentMutationIdentity(input: {
  currentDoc: DocumentState;
  generation: DocumentStoreSyncGeneration;
  state: DocumentStoreState;
}): Promise<void> {
  await persistDocument(
    input.state,
    input.currentDoc,
    {},
    {
      preserveSnapshotStructuredFields: true,
      preserveSnapshotText: true,
    },
    input.generation,
  );
}

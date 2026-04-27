import invariant from "invariant";
import {
  initializeDocumentAccess,
  listRecipientEncapsulationPublicKeys,
  resolveDocumentAccessState,
} from "../../src/access/documentAccess";
import { db } from "../../src/adapters/postgres";
import { documentContainerLinks, documents } from "../../src/schema";

export async function createDocumentFixture(input: {
  readonly createdByFingerprint: string;
  readonly documentId?: string;
  readonly linkedContainerIds: readonly string[];
}) {
  return db.transaction(async (tx) => {
    const [document] = await tx
      .insert(documents)
      .values({
        ...(input.documentId ? { id: input.documentId } : {}),
        createdByFingerprint: input.createdByFingerprint,
      })
      .returning();
    invariant(document, "expected document fixture row");

    await tx.insert(documentContainerLinks).values(
      input.linkedContainerIds.map((containerId) => ({
        documentId: document.id,
        containerId,
      })),
    );

    const currentAccessEpoch = await initializeDocumentAccess(document.id, tx);
    const access = await resolveDocumentAccessState(document.id, tx);
    invariant(access, "expected document fixture access state");

    return {
      currentAccessEpoch,
      currentAccessStateHash: access.accessStateHash,
      document,
      id: document.id,
      linkedContainerIds: [...input.linkedContainerIds].sort(),
      recipientEncapsulationPublicKeys:
        listRecipientEncapsulationPublicKeys(access),
      referencedPrincipals: access.referencedPrincipals,
    };
  });
}

import {
  readEncryptedUpdateAccessEpoch,
  type SyncDocumentOutgoingUpdate,
} from "@tearleads/loro";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { SerializedRecipientEnvelope } from "@tearleads/validators/util";
import { inArray } from "drizzle-orm";
import {
  documentRecipientEnvelopesMatchRecipients,
  initializeDocumentAccess,
  listRecipientEncapsulationPublicKeys,
  replaceDocumentRecipientEnvelopes,
  resolveDocumentAccessState,
} from "../../access/documentAccess";
import type { DatabaseTransaction } from "../../adapters/postgres";
import {
  containerMetadataDocuments,
  documentContainerLinks,
  documents,
  documentUpdates,
} from "../../schema";
import { uniqueSortedStrings } from "../../utils/array";
import { insertDocumentUpdateSpans } from "../documents/documentUpdateSpans";

function matchesAccessEpoch(
  encryptedData: string,
  expectedAccessEpoch: number,
): boolean {
  return readEncryptedUpdateAccessEpoch(encryptedData) === expectedAccessEpoch;
}

async function appendDocumentUpdates(
  tx: DatabaseTransaction,
  documentId: string,
  accessEpoch: number,
  authorFingerprint: string,
  updates: ReadonlyArray<SyncDocumentOutgoingUpdate>,
): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  const updateIds = uniqueSortedStrings(updates.map((update) => update.id));
  const existingRows = await tx
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(inArray(documentUpdates.id, updateIds));
  const existingUpdateIds = new Set(existingRows.map((row) => row.id));
  const newUpdates: SyncDocumentOutgoingUpdate[] = [];

  for (const update of updates) {
    if (existingUpdateIds.has(update.id)) {
      continue;
    }

    existingUpdateIds.add(update.id);
    newUpdates.push(update);
  }

  if (newUpdates.length === 0) {
    return;
  }

  const insertedRows = await tx
    .insert(documentUpdates)
    .values(
      newUpdates.map((update) => ({
        id: update.id,
        documentId,
        accessEpoch,
        authorFingerprint,
        encryptedData: update.encryptedData,
        partialStartVersionVector: update.partialStartVersionVector,
        partialEndVersionVector: update.partialEndVersionVector,
      })),
    )
    .returning({ id: documentUpdates.id });
  const insertedUpdateIds = new Set(insertedRows.map((row) => row.id));

  await insertDocumentUpdateSpans(tx, {
    documentId,
    updates: newUpdates.filter((update) => insertedUpdateIds.has(update.id)),
  });
}

async function validateMetadataRecipients(
  encryptedUpdates: ReadonlyArray<SyncDocumentOutgoingUpdate>,
  expectedAccessEpoch: number,
): Promise<void> {
  for (const update of encryptedUpdates) {
    try {
      if (!matchesAccessEpoch(update.encryptedData, expectedAccessEpoch)) {
        throw new ContainerMetadataError(
          "Encrypted metadata update access epoch mismatch",
          400,
        );
      }
    } catch (error) {
      if (error instanceof ContainerMetadataError) {
        throw error;
      }

      throw new ContainerMetadataError(
        "Invalid encrypted metadata update envelope",
        400,
      );
    }
  }
}

export class ContainerMetadataError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409,
  ) {
    super(message);
  }
}

export async function createContainerMetadataDocument(
  tx: DatabaseTransaction,
  input: {
    authorFingerprint: string;
    containerId: string;
    createdByFingerprint: string;
    metadataDocumentId?: string;
    initialMetadataRecipientEnvelopes?: SerializedRecipientEnvelope[];
    initialMetadataUpdates: ReadonlyArray<SyncDocumentOutgoingUpdate>;
  },
): Promise<{
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataDocumentId: string;
  metadataRecipientEncapsulationPublicKeys: string[];
  metadataReferencedPrincipals: ReferencedPrincipalStateResponse[];
}> {
  const [metadataDocument] = await tx
    .insert(documents)
    .values({
      ...(input.metadataDocumentId ? { id: input.metadataDocumentId } : {}),
      createdByFingerprint: input.createdByFingerprint,
    })
    .returning({ id: documents.id });

  if (!metadataDocument) {
    throw new ContainerMetadataError(
      "Failed to create container metadata document",
      409,
    );
  }

  await tx.insert(containerMetadataDocuments).values({
    containerId: input.containerId,
    documentId: metadataDocument.id,
  });

  await tx.insert(documentContainerLinks).values({
    documentId: metadataDocument.id,
    containerId: input.containerId,
  });

  const metadataAccessEpoch = await initializeDocumentAccess(
    metadataDocument.id,
    tx,
  );
  const access = await resolveDocumentAccessState(metadataDocument.id, tx);

  if (!access) {
    throw new ContainerMetadataError(
      "Container metadata access state is unavailable",
      409,
    );
  }

  if (
    input.initialMetadataRecipientEnvelopes &&
    !documentRecipientEnvelopesMatchRecipients(
      input.initialMetadataRecipientEnvelopes,
      access,
    )
  ) {
    throw new ContainerMetadataError(
      "Metadata document recipient envelopes mismatch",
      400,
    );
  }

  if (input.initialMetadataRecipientEnvelopes) {
    await replaceDocumentRecipientEnvelopes(
      metadataDocument.id,
      metadataAccessEpoch,
      access,
      input.initialMetadataRecipientEnvelopes,
      tx,
    );
  }

  if (
    input.initialMetadataUpdates.length > 0 &&
    !input.initialMetadataRecipientEnvelopes
  ) {
    throw new ContainerMetadataError(
      "Missing metadata document recipient envelopes for current epoch",
      400,
    );
  }

  await validateMetadataRecipients(
    input.initialMetadataUpdates,
    metadataAccessEpoch,
  );

  await appendDocumentUpdates(
    tx,
    metadataDocument.id,
    metadataAccessEpoch,
    input.authorFingerprint,
    input.initialMetadataUpdates,
  );

  return {
    metadataAccessEpoch,
    metadataAccessStateHash: access.accessStateHash,
    metadataDocumentId: metadataDocument.id,
    metadataRecipientEncapsulationPublicKeys:
      listRecipientEncapsulationPublicKeys(access),
    metadataReferencedPrincipals: access.referencedPrincipals,
  };
}

import {
  readEncryptedUpdateAccessEpoch,
  type SyncDocumentOutgoingUpdate,
} from "@tearleads/loro";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { SerializedRecipientEnvelope } from "@tearleads/validators/util";
import { eq } from "drizzle-orm";
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

function matchesAccessEpoch(
  encryptedData: string,
  expectedAccessEpoch: number,
): boolean {
  return readEncryptedUpdateAccessEpoch(encryptedData) === expectedAccessEpoch;
}

async function appendDocumentUpdates(
  tx: DatabaseTransaction,
  documentId: string,
  authorFingerprint: string,
  updates: ReadonlyArray<SyncDocumentOutgoingUpdate>,
): Promise<void> {
  for (const update of updates) {
    const [existing] = await tx
      .select({ id: documentUpdates.id })
      .from(documentUpdates)
      .where(eq(documentUpdates.id, update.id))
      .limit(1);

    if (existing) {
      continue;
    }

    await tx.insert(documentUpdates).values({
      id: update.id,
      documentId,
      authorFingerprint,
      encryptedData: update.encryptedData,
      partialStartVersionVector: update.partialStartVersionVector,
      partialEndVersionVector: update.partialEndVersionVector,
    });
  }
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
    initialMetadataRecipientEnvelopes?: SerializedRecipientEnvelope[];
    initialMetadataUpdates: ReadonlyArray<SyncDocumentOutgoingUpdate>;
  },
): Promise<{
  metadataAccessEpoch: number;
  metadataDocumentId: string;
  metadataRecipientEncapsulationPublicKeys: string[];
  metadataReferencedPrincipals: ReferencedPrincipalStateResponse[];
}> {
  const [metadataDocument] = await tx
    .insert(documents)
    .values({
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
    input.authorFingerprint,
    input.initialMetadataUpdates,
  );

  return {
    metadataAccessEpoch,
    metadataDocumentId: metadataDocument.id,
    metadataRecipientEncapsulationPublicKeys:
      listRecipientEncapsulationPublicKeys(access),
    metadataReferencedPrincipals: access.referencedPrincipals,
  };
}

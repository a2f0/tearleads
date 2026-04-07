import {
  parseEnvelope,
  type SyncDocumentOutgoingUpdate,
} from "@tearleads/loro";
import { eq } from "drizzle-orm";
import {
  initializeDocumentAccess,
  listRecipientEncapsulationPublicKeys,
  listRecipientKeyFingerprints,
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

function matchesRecipients(
  encryptedData: string,
  expectedRecipientKeyFingerprints: string[],
): boolean {
  const recipientKeyFingerprints = uniqueSortedStrings(
    parseEnvelope(encryptedData).recipients.map(
      (recipient) => recipient.keyFingerprint,
    ),
  );

  return (
    recipientKeyFingerprints.length ===
      expectedRecipientKeyFingerprints.length &&
    recipientKeyFingerprints.every(
      (fingerprint, index) =>
        fingerprint === expectedRecipientKeyFingerprints[index],
    )
  );
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
  expectedRecipientKeyFingerprints: string[],
): Promise<void> {
  for (const update of encryptedUpdates) {
    try {
      if (
        !matchesRecipients(
          update.encryptedData,
          expectedRecipientKeyFingerprints,
        )
      ) {
        throw new ContainerMetadataError(
          "Encrypted metadata update recipients mismatch",
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
    initialMetadataUpdates: ReadonlyArray<SyncDocumentOutgoingUpdate>;
  },
): Promise<{
  metadataAccessEpoch: number;
  metadataDocumentId: string;
  metadataRecipientEncapsulationPublicKeys: string[];
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

  const expectedRecipientKeyFingerprints = uniqueSortedStrings(
    listRecipientKeyFingerprints(access),
  );
  await validateMetadataRecipients(
    input.initialMetadataUpdates,
    expectedRecipientKeyFingerprints,
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
  };
}

import type { VerifiedDocumentLinkSetManifest } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { getCurrentAccessManifestHead } from "../../../../access/read/accessManifestStore";
import type { DatabaseTransaction } from "../../../../adapters/postgres";
import {
  containerMetadataDocuments,
  documentContainerLinks,
  documents,
} from "../../../../schema";
import { DocumentMutationError } from "../errors";

export async function insertDocumentAndLinks(input: {
  readonly createdByFingerprint: string;
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedDocumentLinkSetManifest;
}) {
  const [inserted] = await input.executor
    .insert(documents)
    .values({
      id: input.manifest.state.documentId,
      createdByFingerprint: input.createdByFingerprint,
    })
    .returning();
  if (!inserted) {
    throw new DocumentMutationError("Failed to create document", 409);
  }

  await input.executor.insert(documentContainerLinks).values(
    input.manifest.state.linkedContainerIds.map((containerId) => ({
      documentId: input.manifest.state.documentId,
      containerId,
    })),
  );

  return inserted;
}

export async function assertCreateCanAdvanceDocumentHead(
  executor: DatabaseTransaction,
  documentId: string,
): Promise<void> {
  const head = await getCurrentAccessManifestHead(
    "document",
    documentId,
    executor,
  );
  if (head) {
    throw new DocumentMutationError("Document manifest already exists", 409);
  }
}

export async function assertDocumentLinkSetCanAdvance(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedDocumentLinkSetManifest;
  readonly previousManifest: VerifiedDocumentLinkSetManifest;
}): Promise<void> {
  if (
    input.manifest.state.documentId !== input.documentId ||
    input.previousManifest.state.documentId !== input.documentId
  ) {
    throw new DocumentMutationError("Document id mismatch", 400);
  }

  const currentHead = await getCurrentAccessManifestHead(
    "document",
    input.documentId,
    input.executor,
  );
  if (!currentHead) {
    throw new DocumentMutationError("Document manifest head missing", 404);
  }
  if (currentHead.manifestHash !== input.previousManifest.manifestHash) {
    throw new DocumentMutationError("Document manifest is stale", 409);
  }
}

export async function assertDocumentCanRelink(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  await ensureDocumentExists({
    documentId: input.documentId,
    executor: input.executor,
  });

  const [metadataBinding] = await input.executor
    .select({ documentId: containerMetadataDocuments.documentId })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.documentId, input.documentId))
    .limit(1);

  if (metadataBinding) {
    throw new DocumentMutationError(
      "Container metadata documents cannot be structurally relinked",
      409,
    );
  }
}

export async function replaceDocumentContainerLinks(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly linkedContainerIds: readonly string[];
}): Promise<void> {
  await input.executor
    .delete(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, input.documentId));

  await input.executor.insert(documentContainerLinks).values(
    input.linkedContainerIds.map((containerId) => ({
      documentId: input.documentId,
      containerId,
    })),
  );
}

export async function ensureDocumentExists(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  const [document] = await input.executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!document) {
    throw new DocumentMutationError("Document not found", 404);
  }
}

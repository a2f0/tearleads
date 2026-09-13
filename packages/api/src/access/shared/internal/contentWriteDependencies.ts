import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobContentWriteHeaders,
  documentContentWriteHeaders,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";

/** Retained ciphertext must remain accompanied by the paths signed by its writer. */
export async function listDocumentContentWriteDependencyHashes(
  documentId: string,
  executor: DatabaseSession,
): Promise<string[]> {
  const [documentHeaders, blobHeaders] = await Promise.all([
    executor
      .select({ header: documentContentWriteHeaders.header })
      .from(documentContentWriteHeaders)
      .where(eq(documentContentWriteHeaders.documentId, documentId)),
    executor
      .select({ header: blobContentWriteHeaders.header })
      .from(blobContentWriteHeaders)
      .innerJoin(
        attachmentBindings,
        eq(attachmentBindings.blobId, blobContentWriteHeaders.blobId),
      )
      .where(eq(attachmentBindings.documentId, documentId)),
  ]);
  return [
    ...new Set(
      [...documentHeaders, ...blobHeaders].flatMap(
        ({ header }) => header.dependencyManifestHashes,
      ),
    ),
  ].sort();
}

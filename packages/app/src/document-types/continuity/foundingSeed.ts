import {
  type DocumentAttachment,
  type DocumentFoundingUpdate,
  sameDocumentAttachments,
  type Tearleads,
} from "@tearleads/client-sdk";
import type { SeedDocument } from "./seedDocuments";

/** The same content the seeded create validated before it signed its update. */
function foundedWithFixture(
  content: DocumentFoundingUpdate["content"],
  document: SeedDocument,
  intents: readonly DocumentAttachment[],
) {
  const rows = document.rows ?? [];
  return (
    content.documentKind === document.kind &&
    content.text === (document.text ?? "") &&
    Object.entries(document.fields ?? {}).every(
      ([key, value]) => content.structuredFields[key] === value,
    ) &&
    content.rows.length === rows.length &&
    rows.every((row, index) =>
      Object.entries(row).every(
        ([key, value]) => content.rows[index]?.fields[key] === value,
      ),
    ) &&
    sameDocumentAttachments(intents, content.attachments)
  );
}

/**
 * A resumed seed adds bytes only to a document this account founded with the
 * fixture. The current fingerprint is not enough: any writer can copy it into
 * a later edit. The founding update is the one a seeded create commits with
 * the document, so later edits by any device leave it unchanged.
 */
export async function requireFoundingSeed(input: {
  sdk: Tearleads;
  document: SeedDocument;
  localId: string;
  writerUserId: string;
  seedTag: string;
  intents: readonly DocumentAttachment[];
  stillCurrent: () => boolean;
}) {
  const founding = await input.sdk.documents.readFoundingUpdate(input.localId);
  if (!input.stillCurrent())
    throw new Error("The Continuity writer scope changed.");
  if (
    founding?.writerUserId !== input.writerUserId ||
    founding.seedTag !== input.seedTag ||
    !foundedWithFixture(founding.content, input.document, input.intents)
  )
    throw new Error(
      `Seed did not add files to ${input.document.key} because it cannot confirm it created that document with the fixture content. Run seed again, or permanently delete the document on the web to skip it.`,
    );
}

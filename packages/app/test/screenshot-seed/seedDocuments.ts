import type {
  BlobBytes,
  DocumentSnapshot,
  DocumentStore,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import { BIRTH_CERTIFICATE_ATTACHMENT_SLOTS } from "../../src/document-types/birth-certificate/birthCertificateDocument";
import { CREDIT_CARD_ATTACHMENT_SLOTS } from "../../src/document-types/credit-card/creditCardDocument";
import { DRIVER_LICENSE_ATTACHMENT_SLOTS } from "../../src/document-types/drivers-license/driverLicenseDocument";
import { PASSPORT_ATTACHMENT_SLOTS } from "../../src/document-types/passport/passportDocument";
import {
  type DocumentAttachmentSlot,
  resolveAttachmentUploadSlot,
} from "../../src/document-types/shared/documentAttachmentUtils";
import { EQUIPMENT_ATTACHMENT_SLOTS } from "../../src/document-types/shared/equipmentDocumentDefinition";
import { seedTrackerRow } from "./seedTrackerRows";
import type { SeedFile } from "./seedTypes";

export type OpenSeedDocument = (
  kind: StoredDocumentKind,
  containerId: string,
) => DocumentStore;

const SLOTS: Partial<
  Record<StoredDocumentKind, readonly DocumentAttachmentSlot[]>
> = {
  drivers_license: DRIVER_LICENSE_ATTACHMENT_SLOTS,
  passport: PASSPORT_ATTACHMENT_SLOTS,
  birth_certificate: BIRTH_CERTIFICATE_ATTACHMENT_SLOTS,
  credit_card: CREDIT_CARD_ATTACHMENT_SLOTS,
  tool: EQUIPMENT_ATTACHMENT_SLOTS,
  appliance: EQUIPMENT_ATTACHMENT_SLOTS,
};

function resolveSeedSlot(
  file: SeedFile,
  slot: string,
  used: Set<string>,
): string {
  const slots = SLOTS[file.kind] ?? [];
  // Only these exact aliases are part of the Continuity contract.
  const resolved =
    file.kind === "drivers_license" && (slot === "front" || slot === "back")
      ? DRIVER_LICENSE_ATTACHMENT_SLOTS[slot === "front" ? 0 : 1]?.slotId
      : slot;
  const definition = slots.find((candidate) => candidate.slotId === resolved);
  if (!definition || (used.has(definition.slotId) && !definition.multiple)) {
    throw new Error(
      `Unknown or duplicate ${file.kind} attachment slot: ${slot}`,
    );
  }
  used.add(definition.slotId);
  return resolveAttachmentUploadSlot(definition.slotId, slots);
}

export async function seedFiles(
  openDocument: OpenSeedDocument,
  containerId: string,
  files: readonly SeedFile[],
  readAttachment: (fileRef: string) => Promise<BlobBytes>,
): Promise<void> {
  for (const file of files) {
    const store = openDocument(file.kind, containerId);
    await store.ensureInitialized();
    if (file.fields) await store.setStructuredFields(file.kind, file.fields);
    for (const row of file.rows ?? []) await store.addRow(seedTrackerRow(row));
    const used = new Set<string>();
    for (const attachment of file.attachments) {
      const bytes = await readAttachment(attachment.file);
      if (!bytes.length)
        throw new Error(`Empty seed attachment: ${attachment.file}`);
      const upload = {
        bytes,
        mimeType: attachment.mimeType,
        name: attachment.file,
      };
      if (attachment.slot) {
        await store.replaceAttachment(
          resolveSeedSlot(file, attachment.slot, used),
          upload,
        );
      } else {
        if (SLOTS[file.kind])
          throw new Error(`Missing ${file.kind} attachment slot`);
        await (store.attachFiles([upload]) as unknown as Promise<void>);
      }
    }
    assertSeededDocument(store.getSnapshot(), file);
  }
}

function assertSeededDocument(
  snapshot: DocumentSnapshot,
  file: SeedFile,
): void {
  if (
    snapshot.fieldValidationIssues.length ||
    snapshot.rows.length !== (file.rows?.length ?? 0) ||
    snapshot.attachments.length !== file.attachments.length
  ) {
    throw new Error(
      `Seed document did not persist as specified: ${file.kind} (${snapshot.title}) ${JSON.stringify(snapshot.fieldValidationIssues)}`,
    );
  }
}

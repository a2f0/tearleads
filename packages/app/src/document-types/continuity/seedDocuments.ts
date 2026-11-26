import type { StoredDocumentKind } from "@tearleads/client-sdk";
import { applianceDocumentProjectorDefinition } from "../appliance/applianceDocumentDefinition";
import { BIRTH_CERTIFICATE_ATTACHMENT_SLOTS } from "../birth-certificate/birthCertificateDocument";
import { CONTACT_PHOTOS } from "../contact/contactDocumentDefinition";
import { CREDIT_CARD_ATTACHMENT_SLOTS } from "../credit-card/creditCardDocument";
import { DRIVER_LICENSE_ATTACHMENT_SLOTS } from "../drivers-license/driverLicenseDocument";
import { PASSPORT_ATTACHMENT_SLOTS } from "../passport/passportDocument";
import type { DocumentAttachmentSlot } from "../shared/documentAttachmentUtils";
import { toolDocumentProjectorDefinition } from "../tool/toolDocumentDefinition";
import { seedTrackerRow } from "./seedTrackerRows";
import type { SeedAttachment, SeedFile, SeedSpec } from "./seedTypes";

const seedPortraitSlotId = `${CONTACT_PHOTOS.slotId}:portrait`;
const TRACKER_KINDS: ReadonlySet<StoredDocumentKind> = new Set([
  "weight",
  "blood_pressure",
]);

const SLOTS: Partial<
  Record<StoredDocumentKind, readonly DocumentAttachmentSlot[]>
> = {
  drivers_license: DRIVER_LICENSE_ATTACHMENT_SLOTS,
  passport: PASSPORT_ATTACHMENT_SLOTS,
  birth_certificate: BIRTH_CERTIFICATE_ATTACHMENT_SLOTS,
  credit_card: CREDIT_CARD_ATTACHMENT_SLOTS,
  tool: toolDocumentProjectorDefinition.slots,
  appliance: applianceDocumentProjectorDefinition.slots,
};

function resolveSeedSlot(
  file: SeedFile,
  slot: string,
  used: Set<string>,
): DocumentAttachmentSlot {
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
  return definition;
}

export interface SeedDocument {
  key: string;
  kind: StoredDocumentKind;
  text?: string;
  fields?: Readonly<Record<string, string>> | undefined;
  rows?: readonly Readonly<Record<string, string>>[] | undefined;
  attachments: readonly (SeedAttachment & { multiple?: boolean | undefined })[];
}

export function continuityDocuments(spec: SeedSpec): SeedDocument[] {
  return [
    ...(spec.contacts ?? []).map((contact, index) => ({
      key: `contact/${index}`,
      kind: "contact",
      fields: contact.avatar
        ? { ...contact.fields, avatarPhotoSlotId: seedPortraitSlotId }
        : contact.fields,
      attachments: contact.avatar
        ? [{ ...contact.avatar, slot: seedPortraitSlotId }]
        : [],
    })),
    ...(spec.notes ?? []).map((note, index) => ({
      key: `note/${index}`,
      kind: "note",
      text: note.text,
      attachments: [],
    })),
    ...(spec.files ?? []).map((file, index) => {
      const used = new Set<string>();
      return {
        key: `file/${index}`,
        kind: file.kind,
        fields: file.fields,
        // Tracker readings carry a measurement time; passcode rows do not.
        rows: TRACKER_KINDS.has(file.kind)
          ? file.rows?.map(seedTrackerRow)
          : file.rows,
        attachments: file.attachments.map((attachment) => {
          if (attachment.slot) {
            const definition = resolveSeedSlot(file, attachment.slot, used);
            return {
              ...attachment,
              slot: definition.slotId,
              multiple: definition.multiple,
            };
          }
          if (SLOTS[file.kind])
            throw new Error(`Missing ${file.kind} attachment slot`);
          return attachment;
        }),
      };
    }),
  ];
}

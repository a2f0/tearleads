import type { DocumentAttachmentSlot } from "../shared/documentAttachmentUtils";
import { readBirthCertificateFieldsFromRecord } from "./birthCertificateDocumentDefinition";

export const BIRTH_CERTIFICATE_ATTACHMENT_SLOTS: ReadonlyArray<DocumentAttachmentSlot> =
  [{ label: "Birth Certificate Image", slotId: "birth-certificate-image" }];

export function readBirthCertificateFields(
  fields: Readonly<Record<string, unknown>>,
) {
  return readBirthCertificateFieldsFromRecord(fields).fields;
}

import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type StoredDocumentKind,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import { structuredFieldsProjector } from "../shared/documentFieldUtils";
import type { DocumentPhotoCapability } from "../shared/documentPhotos";
import type { AppDocumentProjectorDefinition } from "../types";

export const CONTACT_DOCUMENT_KIND = "contact" satisfies StoredDocumentKind;

// A person reads as a silhouette until a photo is chosen, not as the
// address-book glyph that stands for the document kind.
export const CONTACT_PHOTOS: DocumentPhotoCapability = {
  slotId: "contact-photos",
  avatarFallbackIcon: UserIcon,
};

export type ContactDocumentFields = {
  encapsulationPublicKey: string;
  firstName: string;
  isSelf: string;
  lastName: string;
  nickname: string;
  userId: string;
};

function deriveContactTitle(fields: ContactDocumentFields): string {
  const nickname = fields.nickname.trim();
  if (nickname.length > 0) {
    return nickname;
  }

  const fullName = `${fields.firstName} ${fields.lastName}`.trim();
  if (fullName.length > 0) {
    return fullName;
  }

  // The Tearleads user ID stays out of display titles.
  return "Untitled contact";
}

export function readContactFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<ContactDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  return {
    fields: {
      encapsulationPublicKey: readStringDocumentField(
        source,
        "encapsulationPublicKey",
        issues,
      ),
      firstName: readStringDocumentField(source, "firstName", issues),
      isSelf: readStringDocumentField(source, "isSelf", issues),
      lastName: readStringDocumentField(source, "lastName", issues),
      nickname: readStringDocumentField(source, "nickname", issues),
      userId: readStringDocumentField(source, "userId", issues),
    },
    issues,
  };
}

export const contactDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    photos: CONTACT_PHOTOS,
    createIcon: AddressBookIcon,
    createLabel: "Contact",
    kind: CONTACT_DOCUMENT_KIND,
    label: "contact",
    project: structuredFieldsProjector(
      readContactFieldsFromRecord,
      deriveContactTitle,
      CONTACT_PHOTOS,
    ),
    untitledTitle: "Untitled contact",
  };

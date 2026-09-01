import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type StoredDocumentKind,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import { structuredFieldsProjector } from "../shared/documentFieldUtils";
import type { AppDocumentProjectorDefinition } from "../types";

export const CONTACT_DOCUMENT_KIND = "contact" satisfies StoredDocumentKind;

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

  return fields.userId.trim() || "Untitled contact";
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
    createIcon: AddressBookIcon,
    createLabel: "Contact",
    kind: CONTACT_DOCUMENT_KIND,
    label: "contact",
    project: structuredFieldsProjector(
      readContactFieldsFromRecord,
      deriveContactTitle,
    ),
    untitledTitle: "Untitled contact",
  };

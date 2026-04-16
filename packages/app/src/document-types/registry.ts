import type { ComponentType } from "react";
import type { StoredDocumentKind } from "../data/documents/documentKinds";
import { CreditCardDocumentApp } from "./credit-card/CreditCardApp";
import { DriverLicenseDocumentApp } from "./drivers-license/DriverLicenseApp";
import { NoteDocumentApp } from "./note/NoteDocumentApp";
import type { DocumentTypeAppProps } from "./types";

interface DocumentTypeDefinition {
  App: ComponentType<DocumentTypeAppProps>;
  createLabel: string;
  kind: StoredDocumentKind;
}

export const DOCUMENT_TYPE_DEFINITIONS: ReadonlyArray<DocumentTypeDefinition> =
  [
    {
      App: NoteDocumentApp,
      createLabel: "New Note",
      kind: "note",
    },
    {
      App: DriverLicenseDocumentApp,
      createLabel: "New Driver's License",
      kind: "drivers_license",
    },
    {
      App: CreditCardDocumentApp,
      createLabel: "New Credit Card",
      kind: "credit_card",
    },
  ];

const documentTypeDefinitionByKind = new Map(
  DOCUMENT_TYPE_DEFINITIONS.map((definition) => [definition.kind, definition]),
);

export function getDocumentTypeDefinition(
  kind: StoredDocumentKind,
): DocumentTypeDefinition {
  const definition = documentTypeDefinitionByKind.get(kind);
  if (!definition) {
    throw new Error(`Unsupported document kind: ${kind}`);
  }

  return definition;
}

import {
  DEFAULT_DOCUMENT_KIND,
  type StoredDocumentKind,
} from "@tearleads/client-sdk/documents";
import type { ComponentType } from "react";
import { ContactDocumentApp } from "./contact/ContactDocumentApp";
import { CreditCardDocumentApp } from "./credit-card/CreditCardApp";
import { DriverLicenseDocumentApp } from "./drivers-license/DriverLicenseApp";
import { NoteDocumentApp } from "./note/NoteDocumentApp";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "./projectors";
import type { DocumentTypeAppProps } from "./types";

interface DocumentTypeDefinition {
  App: ComponentType<DocumentTypeAppProps>;
  createLabel: string;
  kind: StoredDocumentKind;
}

const documentTypeAppsByKind = new Map<
  StoredDocumentKind,
  ComponentType<DocumentTypeAppProps>
>([
  [DEFAULT_DOCUMENT_KIND, NoteDocumentApp],
  ["contact", ContactDocumentApp],
  ["drivers_license", DriverLicenseDocumentApp],
  ["credit_card", CreditCardDocumentApp],
]);

export const DOCUMENT_TYPE_DEFINITIONS: ReadonlyArray<DocumentTypeDefinition> =
  APP_DOCUMENT_PROJECTOR_DEFINITIONS.map((definition) => {
    const App = documentTypeAppsByKind.get(definition.kind);
    if (App === undefined) {
      throw new Error(
        `Document type ${definition.kind} is missing a React app registration.`,
      );
    }

    return {
      App,
      createLabel: definition.createLabel,
      kind: definition.kind,
    };
  });

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

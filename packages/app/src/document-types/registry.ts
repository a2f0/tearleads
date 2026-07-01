import type { Icon } from "@phosphor-icons/react";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import type { StoredDocumentKind } from "@tearleads/client-sdk";
import type { ComponentType } from "react";
import { AudioDocumentApp } from "./audio/AudioDocumentApp";
import { AUDIO_DOCUMENT_KIND } from "./audio/audioDocumentDefinition";
import { ContactDocumentApp } from "./contact/ContactDocumentApp";
import { CreditCardDocumentApp } from "./credit-card/CreditCardApp";
import { DriverLicenseDocumentApp } from "./drivers-license/DriverLicenseApp";
import { GenericFileDocumentApp } from "./generic-file/GenericFileDocumentApp";
import { GENERIC_FILE_DOCUMENT_KIND } from "./generic-file/genericFileDocumentDefinition";
import { ImageDocumentApp } from "./image/ImageDocumentApp";
import { IMAGE_DOCUMENT_KIND } from "./image/imageDocumentDefinition";
import { NoteDocumentApp } from "./note/NoteDocumentApp";
import { PdfDocumentApp } from "./pdf/PdfDocumentApp";
import { PDF_DOCUMENT_KIND } from "./pdf/pdfDocumentDefinition";
import {
  APP_DEFAULT_DOCUMENT_KIND,
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
} from "./projectors";
import type { DocumentTypeAppProps } from "./types";

interface DocumentTypeDefinition {
  App: ComponentType<DocumentTypeAppProps>;
  createIcon: Icon;
  createLabel: string;
  kind: StoredDocumentKind;
}

const documentTypeAppsByKind = new Map<
  StoredDocumentKind,
  ComponentType<DocumentTypeAppProps>
>([
  [APP_DEFAULT_DOCUMENT_KIND, NoteDocumentApp],
  ["contact", ContactDocumentApp],
  ["drivers_license", DriverLicenseDocumentApp],
  ["credit_card", CreditCardDocumentApp],
  ["image", ImageDocumentApp],
  ["audio", AudioDocumentApp],
  ["pdf", PdfDocumentApp],
  ["generic_file", GenericFileDocumentApp],
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
      createIcon: definition.createIcon,
      createLabel: definition.createLabel,
      kind: definition.kind,
    };
  });

// File-backed kinds enter the workspace through upload, not the
// "New Document" picker, so they are excluded from creation.
const UPLOAD_ONLY_DOCUMENT_KINDS: ReadonlySet<StoredDocumentKind> = new Set([
  IMAGE_DOCUMENT_KIND,
  AUDIO_DOCUMENT_KIND,
  PDF_DOCUMENT_KIND,
  GENERIC_FILE_DOCUMENT_KIND,
]);

export const CREATABLE_DOCUMENT_TYPE_DEFINITIONS: ReadonlyArray<DocumentTypeDefinition> =
  DOCUMENT_TYPE_DEFINITIONS.filter(
    (definition) => !UPLOAD_ONLY_DOCUMENT_KINDS.has(definition.kind),
  );

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

// The icon representing a document kind, shared by the "New Document" picker
// and the explorer item list. Falls back to a generic file icon for kinds
// without a registered definition so callers never have to guard.
export function getDocumentTypeIcon(kind: StoredDocumentKind): Icon {
  return documentTypeDefinitionByKind.get(kind)?.createIcon ?? FileIcon;
}

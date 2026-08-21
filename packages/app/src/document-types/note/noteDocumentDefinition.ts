import { NoteIcon } from "@phosphor-icons/react/dist/csr/Note";
import type { StoredDocumentKind } from "@symcrypt/client-sdk";
import type { AppDocumentProjectorDefinition } from "../types";

export const APP_DEFAULT_DOCUMENT_KIND = "note" satisfies StoredDocumentKind;

function deriveNoteTitle(text: string): string {
  let lineStart = 0;
  while (lineStart <= text.length) {
    const lineBreakIndex = text.indexOf("\n", lineStart);
    const lineEnd = lineBreakIndex === -1 ? text.length : lineBreakIndex;
    const trimmed = text.slice(lineStart, lineEnd).trim();
    if (trimmed.length > 0) {
      return trimmed;
    }

    if (lineBreakIndex === -1) {
      break;
    }

    lineStart = lineBreakIndex + 1;
  }

  return "Untitled note";
}

export const noteDocumentProjectorDefinition: AppDocumentProjectorDefinition = {
  createIcon: NoteIcon,
  createLabel: "Note",
  kind: APP_DEFAULT_DOCUMENT_KIND,
  label: "note",
  project: ({ text }) => ({
    fieldValidationIssues: [],
    structuredFields: {},
    title: deriveNoteTitle(text),
  }),
  untitledTitle: "Untitled note",
};

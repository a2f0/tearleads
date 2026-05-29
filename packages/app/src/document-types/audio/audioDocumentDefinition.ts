import {
  deriveFileDocumentTitle,
  readAudioDocumentFieldsFromRecord,
} from "../shared/fileDocumentDefinition";
import type { AppDocumentProjectorDefinition } from "../types";

export const AUDIO_DOCUMENT_KIND = "audio";
const AUDIO_DOCUMENT_UNTITLED_TITLE = "Untitled audio";

export const audioDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createLabel: "New Audio",
    kind: AUDIO_DOCUMENT_KIND,
    label: "audio",
    project: ({ structuredFields }) => {
      const validated = readAudioDocumentFieldsFromRecord(structuredFields);
      return {
        fieldValidationIssues: validated.issues,
        structuredFields: { ...validated.fields },
        title: deriveFileDocumentTitle(
          validated.fields,
          AUDIO_DOCUMENT_UNTITLED_TITLE,
        ),
      };
    },
    untitledTitle: AUDIO_DOCUMENT_UNTITLED_TITLE,
  };

import { FileVideoIcon } from "@phosphor-icons/react/dist/csr/FileVideo";
import {
  deriveFileDocumentTitle,
  readVideoDocumentFieldsFromRecord,
} from "../shared/fileDocumentDefinition";
import type { AppDocumentProjectorDefinition } from "../types";

export const VIDEO_DOCUMENT_KIND = "video";
const VIDEO_DOCUMENT_UNTITLED_TITLE = "Untitled video";

export const videoDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createIcon: FileVideoIcon,
    createLabel: "Video",
    kind: VIDEO_DOCUMENT_KIND,
    label: "video",
    project: ({ structuredFields }) => {
      const validated = readVideoDocumentFieldsFromRecord(structuredFields);
      return {
        fieldValidationIssues: validated.issues,
        structuredFields: { ...validated.fields },
        title: deriveFileDocumentTitle(
          validated.fields,
          VIDEO_DOCUMENT_UNTITLED_TITLE,
        ),
      };
    },
    untitledTitle: VIDEO_DOCUMENT_UNTITLED_TITLE,
  };

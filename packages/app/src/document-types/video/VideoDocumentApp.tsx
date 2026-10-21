import { createFileDocumentTypeApp } from "../shared/createDocumentTypeApp";
import {
  DIMENSIONS_FIELD,
  DURATION_FIELD,
} from "../shared/fileDocumentReadFields";
import { VIDEO_DOCUMENT_KIND } from "./videoDocumentDefinition";

export const VideoDocumentApp = createFileDocumentTypeApp(VIDEO_DOCUMENT_KIND, {
  extraFields: [DURATION_FIELD, DIMENSIONS_FIELD],
  title: "Video",
});

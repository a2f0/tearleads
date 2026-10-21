import { createFileDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { DURATION_FIELD } from "../shared/fileDocumentReadFields";
import { AUDIO_DOCUMENT_KIND } from "./audioDocumentDefinition";

export const AudioDocumentApp = createFileDocumentTypeApp(AUDIO_DOCUMENT_KIND, {
  extraFields: [DURATION_FIELD],
  title: "Audio",
});

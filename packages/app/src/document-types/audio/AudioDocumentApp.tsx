import { createFileDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { AUDIO_DOCUMENT_KIND } from "./audioDocumentDefinition";

export const AudioDocumentApp = createFileDocumentTypeApp(AUDIO_DOCUMENT_KIND, {
  extraFieldLabels: { durationMs: "Duration" },
  title: "Audio",
});

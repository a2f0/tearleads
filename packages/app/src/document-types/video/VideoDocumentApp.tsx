import { createFileDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { VIDEO_DOCUMENT_KIND } from "./videoDocumentDefinition";

export const VideoDocumentApp = createFileDocumentTypeApp(VIDEO_DOCUMENT_KIND, {
  extraFieldLabels: {
    durationMs: "Duration",
    height: "Height",
    width: "Width",
  },
  title: "Video",
});

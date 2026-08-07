import { FileVideoIcon } from "@phosphor-icons/react/dist/csr/FileVideo";
import {
  createFileDocumentType,
  readVideoDocumentFieldsFromRecord,
} from "../shared/fileDocumentDefinition";

export const VIDEO_DOCUMENT_KIND = "video";
const VIDEO_DOCUMENT_UNTITLED_TITLE = "Untitled video";

export const videoDocumentProjectorDefinition = createFileDocumentType({
  createIcon: FileVideoIcon,
  createLabel: "Video",
  kind: VIDEO_DOCUMENT_KIND,
  label: "video",
  readFields: readVideoDocumentFieldsFromRecord,
  untitledTitle: VIDEO_DOCUMENT_UNTITLED_TITLE,
});

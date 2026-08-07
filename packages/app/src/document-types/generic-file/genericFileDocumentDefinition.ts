import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import {
  createFileDocumentType,
  readFileDocumentFieldsFromRecord,
} from "../shared/fileDocumentDefinition";

export const GENERIC_FILE_DOCUMENT_KIND = "generic_file";
const GENERIC_FILE_DOCUMENT_UNTITLED_TITLE = "Untitled file";

export const genericFileDocumentProjectorDefinition = createFileDocumentType({
  createIcon: FileIcon,
  createLabel: "File",
  kind: GENERIC_FILE_DOCUMENT_KIND,
  label: "file",
  readFields: readFileDocumentFieldsFromRecord,
  untitledTitle: GENERIC_FILE_DOCUMENT_UNTITLED_TITLE,
});

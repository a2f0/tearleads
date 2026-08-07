import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import {
  createFileDocumentType,
  readImageDocumentFieldsFromRecord,
} from "../shared/fileDocumentDefinition";

export const IMAGE_DOCUMENT_KIND = "image";
const IMAGE_DOCUMENT_UNTITLED_TITLE = "Untitled image";

export const imageDocumentProjectorDefinition = createFileDocumentType({
  createIcon: ImageIcon,
  createLabel: "Image",
  kind: IMAGE_DOCUMENT_KIND,
  label: "image",
  readFields: readImageDocumentFieldsFromRecord,
  untitledTitle: IMAGE_DOCUMENT_UNTITLED_TITLE,
});

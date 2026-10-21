import { createFileDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { DIMENSIONS_FIELD } from "../shared/fileDocumentReadFields";
import { IMAGE_DOCUMENT_KIND } from "./imageDocumentDefinition";

export const ImageDocumentApp = createFileDocumentTypeApp(IMAGE_DOCUMENT_KIND, {
  extraFields: [DIMENSIONS_FIELD],
  title: "Image",
});

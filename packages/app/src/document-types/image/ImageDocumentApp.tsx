import { createFileDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { IMAGE_DOCUMENT_KIND } from "./imageDocumentDefinition";

export const ImageDocumentApp = createFileDocumentTypeApp(IMAGE_DOCUMENT_KIND, {
  extraFieldLabels: {
    height: "Height",
    width: "Width",
  },
  title: "Image",
});

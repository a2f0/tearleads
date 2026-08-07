import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { ContactDocument } from "./ContactDocument";
import { CONTACT_DOCUMENT_KIND } from "./contactDocumentDefinition";

export const ContactDocumentApp = createDocumentTypeApp(
  CONTACT_DOCUMENT_KIND,
  ContactDocument,
);

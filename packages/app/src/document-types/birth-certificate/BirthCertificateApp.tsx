import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { BirthCertificate } from "./BirthCertificate";
import { BIRTH_CERTIFICATE_DOCUMENT_KIND } from "./birthCertificateDocumentDefinition";

export const BirthCertificateDocumentApp = createDocumentTypeApp(
  BIRTH_CERTIFICATE_DOCUMENT_KIND,
  BirthCertificate,
);

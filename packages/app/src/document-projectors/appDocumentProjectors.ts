import { contactDocumentProjectorDefinition } from "../document-types/contact/contactDocumentDefinition";
import { creditCardDocumentProjectorDefinition } from "../document-types/credit-card/creditCardDocumentDefinition";
import { driverLicenseDocumentProjectorDefinition } from "../document-types/drivers-license/driverLicenseDocumentDefinition";
import { noteDocumentProjectorDefinition } from "../document-types/note/noteDocument";
import type { AppDocumentProjectorDefinition } from "../document-types/types";
import { contactClientProjection } from "./contactClientProjection";
import { creditCardClientProjection } from "./creditCardClientProjection";
import { driverLicenseClientProjection } from "./driverLicenseClientProjection";

export const APP_DOCUMENT_PROJECTOR_DEFINITIONS: ReadonlyArray<AppDocumentProjectorDefinition> =
  [
    noteDocumentProjectorDefinition,
    {
      ...contactDocumentProjectorDefinition,
      clientProjection: contactClientProjection,
    },
    {
      ...driverLicenseDocumentProjectorDefinition,
      clientProjection: driverLicenseClientProjection,
    },
    {
      ...creditCardDocumentProjectorDefinition,
      clientProjection: creditCardClientProjection,
    },
  ];

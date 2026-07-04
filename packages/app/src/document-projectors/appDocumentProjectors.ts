import { audioDocumentProjectorDefinition } from "../document-types/audio/audioDocumentDefinition";
import { contactDocumentProjectorDefinition } from "../document-types/contact/contactDocumentDefinition";
import { creditCardDocumentProjectorDefinition } from "../document-types/credit-card/creditCardDocumentDefinition";
import { driverLicenseDocumentProjectorDefinition } from "../document-types/drivers-license/driverLicenseDocumentDefinition";
import { genericFileDocumentProjectorDefinition } from "../document-types/generic-file/genericFileDocumentDefinition";
import { imageDocumentProjectorDefinition } from "../document-types/image/imageDocumentDefinition";
import { noteDocumentProjectorDefinition } from "../document-types/note/noteDocumentDefinition";
import { passportDocumentProjectorDefinition } from "../document-types/passport/passportDocumentDefinition";
import { pdfDocumentProjectorDefinition } from "../document-types/pdf/pdfDocumentDefinition";
import type { AppDocumentProjectorDefinition } from "../document-types/types";
import { contactClientProjection } from "./contactClientProjection";
import { creditCardClientProjection } from "./creditCardClientProjection";
import { driverLicenseClientProjection } from "./driverLicenseClientProjection";
import { passportClientProjection } from "./passportClientProjection";

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
    {
      ...passportDocumentProjectorDefinition,
      clientProjection: passportClientProjection,
    },
    imageDocumentProjectorDefinition,
    audioDocumentProjectorDefinition,
    pdfDocumentProjectorDefinition,
    genericFileDocumentProjectorDefinition,
  ];

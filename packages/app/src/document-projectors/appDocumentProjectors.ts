import type { DocumentProjectorDefinition } from "@tearleads/client-sdk";
import { audioDocumentProjectorDefinition } from "../document-types/audio/audioDocumentDefinition";
import { bloodPressureDocumentProjectorDefinition } from "../document-types/blood-pressure/bloodPressureDocumentDefinition";
import { contactDocumentProjectorDefinition } from "../document-types/contact/contactDocumentDefinition";
import { creditCardDocumentProjectorDefinition } from "../document-types/credit-card/creditCardDocumentDefinition";
import { driverLicenseDocumentProjectorDefinition } from "../document-types/drivers-license/driverLicenseDocumentDefinition";
import { envFileDocumentProjectorDefinition } from "../document-types/env-file/envFileDocumentDefinition";
import { genericFileDocumentProjectorDefinition } from "../document-types/generic-file/genericFileDocumentDefinition";
import { imageDocumentProjectorDefinition } from "../document-types/image/imageDocumentDefinition";
import { jsonFileDocumentProjectorDefinition } from "../document-types/json-file/jsonFileDocumentDefinition";
import { noteDocumentProjectorDefinition } from "../document-types/note/noteDocumentDefinition";
import { passportDocumentProjectorDefinition } from "../document-types/passport/passportDocumentDefinition";
import { pdfDocumentProjectorDefinition } from "../document-types/pdf/pdfDocumentDefinition";
import type { AppDocumentProjectorDefinition } from "../document-types/types";
import { videoDocumentProjectorDefinition } from "../document-types/video/videoDocumentDefinition";
import { weightDocumentProjectorDefinition } from "../document-types/weight/weightDocumentDefinition";
import { contactClientProjection } from "./contactClientProjection";
import { creditCardClientProjection } from "./creditCardClientProjection";
import { driverLicenseClientProjection } from "./driverLicenseClientProjection";
import { organizationProfileDocumentProjectorDefinition } from "./organizationProfileDocumentProjector";
import { passportClientProjection } from "./passportClientProjection";

// Projectors whose kinds also have registered React document apps.
export const APP_DOCUMENT_TYPE_PROJECTOR_DEFINITIONS: ReadonlyArray<AppDocumentProjectorDefinition> =
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
    envFileDocumentProjectorDefinition,
    bloodPressureDocumentProjectorDefinition,
    weightDocumentProjectorDefinition,
    jsonFileDocumentProjectorDefinition,
    imageDocumentProjectorDefinition,
    audioDocumentProjectorDefinition,
    videoDocumentProjectorDefinition,
    pdfDocumentProjectorDefinition,
    genericFileDocumentProjectorDefinition,
  ];

// Every app-side projector, including system-only projection kinds.
export const APP_DOCUMENT_PROJECTOR_DEFINITIONS: ReadonlyArray<DocumentProjectorDefinition> =
  [
    ...APP_DOCUMENT_TYPE_PROJECTOR_DEFINITIONS,
    organizationProfileDocumentProjectorDefinition,
  ];

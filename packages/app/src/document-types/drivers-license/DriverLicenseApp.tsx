import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { DriverLicense } from "./DriverLicense";
import { DRIVER_LICENSE_DOCUMENT_KIND } from "./driverLicenseDocumentDefinition";

export const DriverLicenseDocumentApp = createDocumentTypeApp(
  DRIVER_LICENSE_DOCUMENT_KIND,
  DriverLicense,
);

import { createEquipmentDocumentTypeApp } from "../shared/EquipmentDocument";
import { applianceDocumentProjectorDefinition } from "./applianceDocumentDefinition";

export const ApplianceDocumentApp = createEquipmentDocumentTypeApp(
  applianceDocumentProjectorDefinition,
);

import { createEquipmentDocumentTypeApp } from "../shared/EquipmentDocument";
import { toolDocumentProjectorDefinition } from "./toolDocumentDefinition";

export const ToolDocumentApp = createEquipmentDocumentTypeApp(
  toolDocumentProjectorDefinition,
);

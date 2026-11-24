import { WashingMachineIcon } from "@phosphor-icons/react/dist/csr/WashingMachine";
import type { StoredDocumentKind } from "@tearleads/client-sdk";
import {
  createEquipmentDocumentType,
  type EquipmentTypeOption,
} from "../shared/equipmentDocumentDefinition";

export const APPLIANCE_DOCUMENT_KIND = "appliance" satisfies StoredDocumentKind;

// The hard-coded picker entries, in dropdown order.
export const APPLIANCE_TYPE_OPTIONS: ReadonlyArray<EquipmentTypeOption> = [
  { label: "Air Conditioner", value: "air_conditioner" },
  { label: "Dishwasher", value: "dishwasher" },
  { label: "Dryer", value: "dryer" },
  { label: "Freezer", value: "freezer" },
  { label: "Microwave", value: "microwave" },
  { label: "Oven", value: "oven" },
  { label: "Range", value: "range" },
  { label: "Refrigerator", value: "refrigerator" },
  { label: "Washing Machine", value: "washing_machine" },
  { label: "Water Heater", value: "water_heater" },
];

export const applianceDocumentProjectorDefinition = createEquipmentDocumentType(
  {
    createIcon: WashingMachineIcon,
    createLabel: "Appliance",
    kind: APPLIANCE_DOCUMENT_KIND,
    label: "appliance",
    typeOptions: APPLIANCE_TYPE_OPTIONS,
    untitledTitle: "Untitled appliance",
  },
);

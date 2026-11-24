import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import type { StoredDocumentKind } from "@tearleads/client-sdk";
import {
  createEquipmentDocumentType,
  type EquipmentTypeOption,
} from "../shared/equipmentDocumentDefinition";

export const TOOL_DOCUMENT_KIND = "tool" satisfies StoredDocumentKind;

// The hard-coded picker entries, in dropdown order.
export const TOOL_TYPE_OPTIONS: ReadonlyArray<EquipmentTypeOption> = [
  { label: "Chainsaw", value: "chainsaw" },
  { label: "Circular Saw", value: "circular_saw" },
  { label: "Drill", value: "drill" },
  { label: "Hedge Trimmer", value: "hedge_trimmer" },
  { label: "Impact Driver", value: "impact_driver" },
  { label: "Lawn Mower", value: "lawn_mower" },
  { label: "Leaf Blower", value: "leaf_blower" },
  { label: "Pressure Washer", value: "pressure_washer" },
  { label: "Sander", value: "sander" },
  { label: "Snow Blower", value: "snow_blower" },
  { label: "Weed Wacker", value: "weed_wacker" },
];

export const toolDocumentProjectorDefinition = createEquipmentDocumentType({
  createIcon: WrenchIcon,
  createLabel: "Tool",
  kind: TOOL_DOCUMENT_KIND,
  label: "tool",
  typeOptions: TOOL_TYPE_OPTIONS,
  untitledTitle: "Untitled tool",
});

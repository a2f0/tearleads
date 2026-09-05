import type { Icon } from "@phosphor-icons/react";
import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type StoredDocumentKind,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import type { AppDocumentProjectorDefinition } from "../types";
import type { DocumentAttachmentSlot } from "./documentAttachmentUtils";
import { structuredFieldsProjector } from "./documentFieldUtils";

/**
 * The fields every owned-equipment document (tool, appliance) records. The
 * type is one of the kind's hard-coded picker options, stored by its stable
 * value (e.g. "leaf_blower") rather than its display label so the label can be
 * reworded without touching stored documents.
 */
export type EquipmentDocumentFields = {
  equipmentType: string;
  make: string;
  model: string;
  serialNumber: string;
};

export interface EquipmentTypeOption {
  readonly label: string;
  readonly value: string;
}

export interface EquipmentDocumentTypeDefinition
  extends AppDocumentProjectorDefinition {
  readonly label: string;
  readonly typeOptions: ReadonlyArray<EquipmentTypeOption>;
  readonly untitledTitle: string;
}

const EQUIPMENT_RECEIPT_IMAGE_SLOT_ID = "receipt-image";

// Every equipment kind keeps one picture of its purchase receipt.
export const EQUIPMENT_ATTACHMENT_SLOTS: ReadonlyArray<DocumentAttachmentSlot> =
  [
    {
      label: "Receipt Image",
      slotId: EQUIPMENT_RECEIPT_IMAGE_SLOT_ID,
    },
  ];

export function readEquipmentFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<EquipmentDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  return {
    fields: {
      equipmentType: readStringDocumentField(source, "equipmentType", issues),
      make: readStringDocumentField(source, "make", issues),
      model: readStringDocumentField(source, "model", issues),
      serialNumber: readStringDocumentField(source, "serialNumber", issues),
    },
    issues,
  };
}

export function readEquipmentFields(
  fields: Readonly<Record<string, unknown>>,
): EquipmentDocumentFields {
  return readEquipmentFieldsFromRecord(fields).fields;
}

function humanizeEquipmentType(value: string): string {
  return value
    .split(/[\s_-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/**
 * The display label for a stored type value. A value outside the kind's option
 * list (written by a newer client with a longer list) is humanized rather than
 * dropped so the document still reads sensibly here.
 */
export function getEquipmentTypeLabel(
  options: ReadonlyArray<EquipmentTypeOption>,
  value: string,
): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  return (
    options.find((option) => option.value === trimmed)?.label ??
    humanizeEquipmentType(trimmed)
  );
}

interface EquipmentDocumentTypeConfig {
  createIcon: Icon;
  createLabel: string;
  kind: StoredDocumentKind;
  label: string;
  typeOptions: ReadonlyArray<EquipmentTypeOption>;
  untitledTitle: string;
}

// "Dishwasher Bosch SHPM88Z75N", degrading a step at a time: whichever of
// type, make, and model are filled in, then the serial number alone, then the
// kind's untitled title.
function deriveEquipmentTitle(
  config: EquipmentDocumentTypeConfig,
  fields: EquipmentDocumentFields,
): string {
  const descriptor = [
    getEquipmentTypeLabel(config.typeOptions, fields.equipmentType),
    fields.make.trim(),
    fields.model.trim(),
  ]
    .filter((part) => part.length > 0)
    .join(" ");
  if (descriptor.length > 0) {
    return descriptor;
  }

  const serialNumber = fields.serialNumber.trim();
  return serialNumber.length > 0
    ? `${config.createLabel} ${serialNumber}`
    : config.untitledTitle;
}

export function createEquipmentDocumentType(
  config: EquipmentDocumentTypeConfig,
): EquipmentDocumentTypeDefinition {
  return {
    ...config,
    project: structuredFieldsProjector(
      readEquipmentFieldsFromRecord,
      (fields) => deriveEquipmentTitle(config, fields),
    ),
  };
}

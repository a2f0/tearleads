import type { Icon } from "@phosphor-icons/react";
import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type StoredDocumentKind,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import type { AppDocumentProjectorDefinition } from "../types";
import type { DocumentAttachmentSlot } from "./documentAttachmentUtils";
import {
  type DocumentFieldOption,
  getDocumentFieldOptionLabel,
} from "./documentFieldOptions";
import { structuredFieldsProjector } from "./documentFieldUtils";
import {
  type DocumentPhotoCapability,
  photoCollectionSlot,
} from "./documentPhotos";

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

export interface EquipmentDocumentTypeDefinition
  extends AppDocumentProjectorDefinition {
  readonly photos: DocumentPhotoCapability;
  readonly slots: readonly DocumentAttachmentSlot[];
  readonly label: string;
  readonly typeOptions: ReadonlyArray<DocumentFieldOption>;
  readonly untitledTitle: string;
}

const EQUIPMENT_PHOTO_SLOT_ID = "equipment-photos";
const EQUIPMENT_RECEIPT_IMAGE_SLOT_ID = "receipt-image";

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

interface EquipmentDocumentTypeConfig {
  createIcon: Icon;
  createLabel: string;
  kind: StoredDocumentKind;
  label: string;
  typeOptions: ReadonlyArray<DocumentFieldOption>;
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
    getDocumentFieldOptionLabel(config.typeOptions, fields.equipmentType),
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
  // Every equipment kind keeps a photo gallery whose chosen photo is its
  // avatar, shown over the kind's own glyph until one is picked.
  const photos: DocumentPhotoCapability = {
    slotId: EQUIPMENT_PHOTO_SLOT_ID,
    avatarFallbackIcon: config.createIcon,
  };
  return {
    ...config,
    photos,
    slots: [
      photoCollectionSlot(photos.slotId),
      { label: "Receipt", slotId: EQUIPMENT_RECEIPT_IMAGE_SLOT_ID },
    ],
    project: structuredFieldsProjector(
      readEquipmentFieldsFromRecord,
      (fields) => deriveEquipmentTitle(config, fields),
      photos,
    ),
  };
}

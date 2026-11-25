import { CarIcon } from "@phosphor-icons/react/dist/csr/Car";
import {
  type DocumentFieldValidationIssue,
  type DocumentProjection,
  type DocumentProjectorInput,
  readStringDocumentField,
  type StoredDocumentKind,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import type { DocumentAttachmentSlot } from "../shared/documentAttachmentUtils";
import {
  addDateOnlyFormatIssue,
  addFormatIssue,
  structuredFieldsProjector,
} from "../shared/documentFieldUtils";
import {
  type DocumentPhotoCapability,
  photoCollectionSlot,
} from "../shared/documentPhotos";
import {
  AMOUNT_FORMAT_MESSAGE,
  CURRENCY_CODE_FORMAT_MESSAGE,
  isValidAmount,
  isValidCurrencyCode,
} from "../shared/documentValueFormats";
import { addRowLogIssues } from "../shared/rowLogModel";
import type { AppDocumentProjectorDefinition } from "../types";
import { VEHICLE_SERVICE_LOG } from "./vehicleServiceLog";

export const VEHICLE_DOCUMENT_KIND = "vehicle" satisfies StoredDocumentKind;

export const VEHICLE_FIELDS = [
  { key: "year", label: "Year", inputMode: "numeric", placeholder: "2021" },
  { key: "make", label: "Make", placeholder: "Toyota" },
  { key: "model", label: "Model", placeholder: "RAV4" },
  { key: "vin", label: "VIN" },
  { key: "licensePlate", label: "License Plate" },
  { key: "registrationRegion", label: "Registered In", placeholder: "CA" },
  {
    key: "registrationExpirationDate",
    label: "Registration Expiration",
    type: "date",
  },
  { key: "purchaseDate", label: "Purchase Date", type: "date" },
  {
    key: "purchasePrice",
    label: "Purchase Price",
    inputMode: "decimal",
    placeholder: "24500.00",
  },
  { key: "purchaseCurrency", label: "Purchase Currency", placeholder: "USD" },
  { key: "seller", label: "Seller" },
] as const satisfies ReadonlyArray<{
  inputMode?: "decimal" | "numeric";
  key: string;
  label: string;
  placeholder?: string;
  type?: "date";
}>;

type VehicleFieldKey = (typeof VEHICLE_FIELDS)[number]["key"];
export type VehicleDocumentFields = Record<VehicleFieldKey, string>;

// The first automobile is from 1886; nothing earlier is a model year.
const FIRST_MODEL_YEAR = 1886;
const YEAR_PATTERN = /^\d{4}$/u;
// Modern VINs are 17 characters; older vehicles carry shorter numbers.
const VIN_PATTERN = /^[A-Za-z0-9]{1,17}$/u;

function readVehicleFields(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<VehicleDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  const read = (key: string) => readStringDocumentField(source, key, issues);
  const fields: VehicleDocumentFields = {
    year: read("year"),
    make: read("make"),
    model: read("model"),
    vin: read("vin"),
    licensePlate: read("licensePlate"),
    registrationRegion: read("registrationRegion"),
    registrationExpirationDate: read("registrationExpirationDate"),
    purchaseDate: read("purchaseDate"),
    purchasePrice: read("purchasePrice"),
    purchaseCurrency: read("purchaseCurrency"),
    seller: read("seller"),
  };

  const year = fields.year.trim();
  if (
    year.length > 0 &&
    !(YEAR_PATTERN.test(year) && Number(year) >= FIRST_MODEL_YEAR)
  ) {
    addFormatIssue(issues, "year", fields.year, "Expected a four-digit year.");
  }
  const vin = fields.vin.trim();
  if (vin.length > 0 && !VIN_PATTERN.test(vin)) {
    addFormatIssue(
      issues,
      "vin",
      fields.vin,
      "Expected up to 17 letters and digits.",
    );
  }
  addDateOnlyFormatIssue(
    issues,
    "registrationExpirationDate",
    fields.registrationExpirationDate,
  );
  addDateOnlyFormatIssue(issues, "purchaseDate", fields.purchaseDate);
  if (
    fields.purchasePrice.trim().length > 0 &&
    !isValidAmount(fields.purchasePrice)
  ) {
    addFormatIssue(
      issues,
      "purchasePrice",
      fields.purchasePrice,
      AMOUNT_FORMAT_MESSAGE,
    );
  }
  if (
    fields.purchaseCurrency.trim().length > 0 &&
    !isValidCurrencyCode(fields.purchaseCurrency)
  ) {
    addFormatIssue(
      issues,
      "purchaseCurrency",
      fields.purchaseCurrency,
      CURRENCY_CODE_FORMAT_MESSAGE,
    );
  }

  return { fields, issues };
}

export function readVehicleFieldValues(
  source: Readonly<Record<string, unknown>>,
): VehicleDocumentFields {
  return readVehicleFields(source).fields;
}

const untitledTitle = "Untitled vehicle";

// "2021 Toyota RAV4" from whichever of year, make, and model are set, then the
// plate, then the untitled title. The VIN stays out of the title.
function deriveVehicleTitle(fields: VehicleDocumentFields): string {
  const descriptor = [fields.year, fields.make, fields.model]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ");
  if (descriptor.length > 0) {
    return descriptor;
  }

  const plate = fields.licensePlate.trim();
  return plate.length > 0 ? `Vehicle ${plate}` : untitledTitle;
}

const VEHICLE_PHOTOS: DocumentPhotoCapability = {
  avatarFallbackIcon: CarIcon,
  slotId: "vehicle-photos",
};

export const VEHICLE_SLOTS: ReadonlyArray<DocumentAttachmentSlot> = [
  photoCollectionSlot(VEHICLE_PHOTOS.slotId),
  { accept: "image-or-pdf", label: "Title", slotId: "title" },
  { accept: "image-or-pdf", label: "Registration", slotId: "registration" },
];

const projectVehicleFields = structuredFieldsProjector(
  readVehicleFields,
  deriveVehicleTitle,
  VEHICLE_PHOTOS,
);

function projectVehicle(input: DocumentProjectorInput): DocumentProjection {
  const projection = projectVehicleFields(input);
  const issues = [...projection.fieldValidationIssues];
  addRowLogIssues(input.rows, VEHICLE_SERVICE_LOG.fields, issues);
  return { ...projection, fieldValidationIssues: issues };
}

export const vehicleDocumentProjectorDefinition = {
  createIcon: CarIcon,
  createLabel: "Vehicle",
  kind: VEHICLE_DOCUMENT_KIND,
  label: "vehicle",
  photos: VEHICLE_PHOTOS,
  project: projectVehicle,
  untitledTitle,
} satisfies AppDocumentProjectorDefinition;

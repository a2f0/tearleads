import type { DocumentRow } from "@tearleads/client-sdk";

export const CONTACT_ADDRESS_ROW_TYPE = "postalAddress";

export const CONTACT_ADDRESS_FIELD_DESCRIPTORS = [
  { key: "label", label: "Label" },
  { key: "street", label: "Street address" },
  { key: "extendedAddress", label: "Apartment / suite" },
  { key: "locality", label: "City / locality" },
  { key: "region", label: "State / region" },
  { key: "postalCode", label: "Postal code" },
  { key: "countryCode", label: "Country code" },
] as const;

export type ContactAddressFieldKey =
  (typeof CONTACT_ADDRESS_FIELD_DESCRIPTORS)[number]["key"];
export type ContactAddressFields = Record<ContactAddressFieldKey, string>;

export function readContactAddressFields(
  fields: Readonly<Record<string, string>>,
): ContactAddressFields {
  const {
    label,
    street,
    extendedAddress,
    locality,
    region,
    postalCode,
    countryCode,
  } = fields;
  return {
    label: label ?? "",
    street: street ?? "",
    extendedAddress: extendedAddress ?? "",
    locality: locality ?? "",
    region: region ?? "",
    postalCode: postalCode ?? "",
    countryCode: countryCode ?? "",
  };
}

export function isContactAddressRow(row: DocumentRow): boolean {
  const { recordType } = row.fields;
  return recordType === CONTACT_ADDRESS_ROW_TYPE;
}

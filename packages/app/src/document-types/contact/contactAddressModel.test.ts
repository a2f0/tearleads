import { expect, test } from "bun:test";
import type { DocumentRow } from "@tearleads/client-sdk";
import {
  CONTACT_ADDRESS_FIELD_DESCRIPTORS,
  CONTACT_ADDRESS_ROW_TYPE,
  isContactAddressRow,
  readContactAddressFields,
} from "./contactAddressModel";

test("reads optional international postal fields without normalizing strings", () => {
  expect(CONTACT_ADDRESS_ROW_TYPE).toBe("postalAddress");
  expect(CONTACT_ADDRESS_FIELD_DESCRIPTORS).toEqual([
    { key: "label", label: "Label" },
    { key: "street", label: "Street address" },
    { key: "extendedAddress", label: "Apartment / suite" },
    { key: "locality", label: "City / locality" },
    { key: "region", label: "State / region" },
    { key: "postalCode", label: "Postal code" },
    { key: "countryCode", label: "Country code" },
  ]);
  expect(
    readContactAddressFields({ postalCode: "00123", countryCode: "日本" }),
  ).toEqual({
    label: "",
    street: "",
    extendedAddress: "",
    locality: "",
    region: "",
    postalCode: "00123",
    countryCode: "日本",
  });
});

test("recognizes only the postalAddress row discriminator", () => {
  const row: DocumentRow = {
    id: "address",
    fields: { recordType: "postalAddress" },
    createdBy: "",
    createdAt: "",
    updatedBy: "",
    updatedAt: "",
    createdByPeer: null,
    updatedByPeer: null,
    fieldEditors: {},
  };
  expect(isContactAddressRow(row)).toBe(true);
  expect(isContactAddressRow({ ...row, fields: {} })).toBe(false);
  expect(
    isContactAddressRow({ ...row, fields: { recordType: "future" } }),
  ).toBe(false);
});

import { expect, test } from "bun:test";
import {
  initializeStoredDocumentKind,
  readStoredDocumentState,
  writeStoredDocumentFields,
} from "@tearleads/client-sdk";
import { createDocument } from "@tearleads/loro";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../projectors";
import {
  type EquipmentDocumentFields,
  getEquipmentTypeLabel,
  readEquipmentFieldsFromRecord,
} from "../shared/equipmentDocumentDefinition";
import { APPLIANCE_TYPE_OPTIONS } from "./applianceDocumentDefinition";

async function projectApplianceTitle(
  fields: Partial<EquipmentDocumentFields>,
): Promise<string> {
  const doc = await createDocument("appliance-title");
  initializeStoredDocumentKind(
    doc,
    "appliance",
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
  writeStoredDocumentFields(
    doc,
    "appliance",
    fields,
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
  return readStoredDocumentState(doc, APP_DOCUMENT_PROJECTOR_DEFINITIONS).title;
}

test("appliance fields are stored as first-class Loro state", async () => {
  const doc = await createDocument("appliance-fields");

  initializeStoredDocumentKind(
    doc,
    "appliance",
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
  writeStoredDocumentFields(
    doc,
    "appliance",
    {
      equipmentType: "dishwasher",
      make: "Bosch",
      model: "SHPM88Z75N",
      serialNumber: "FD9912345678",
    },
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );

  expect(
    readStoredDocumentState(doc, APP_DOCUMENT_PROJECTOR_DEFINITIONS),
  ).toMatchObject({
    documentKind: "appliance",
    fieldValidationIssues: [],
    structuredFields: {
      equipmentType: "dishwasher",
      make: "Bosch",
      model: "SHPM88Z75N",
      serialNumber: "FD9912345678",
    },
    title: "Dishwasher Bosch SHPM88Z75N",
  });
});

test("the requested appliance types are all in the dropdown", () => {
  const labels = APPLIANCE_TYPE_OPTIONS.map((option) => option.label);

  expect(labels).toContain("Washing Machine");
  expect(labels).toContain("Microwave");
  expect(labels).toContain("Dishwasher");
  expect(labels).toContain("Refrigerator");
  expect(
    new Set(APPLIANCE_TYPE_OPTIONS.map((option) => option.value)).size,
  ).toBe(APPLIANCE_TYPE_OPTIONS.length);
});

test("appliance title humanizes a type outside the option list", async () => {
  expect(
    await projectApplianceTitle({ equipmentType: "wine_cooler", make: "LG" }),
  ).toBe("Wine Cooler LG");
  expect(await projectApplianceTitle({ equipmentType: "microwave" })).toBe(
    "Microwave",
  );
  expect(await projectApplianceTitle({})).toBe("Untitled appliance");
});

test("type labels resolve from the option list or the stored value", () => {
  expect(getEquipmentTypeLabel(APPLIANCE_TYPE_OPTIONS, "washing_machine")).toBe(
    "Washing Machine",
  );
  expect(getEquipmentTypeLabel(APPLIANCE_TYPE_OPTIONS, " dryer ")).toBe(
    "Dryer",
  );
  expect(getEquipmentTypeLabel(APPLIANCE_TYPE_OPTIONS, "heat-pump")).toBe(
    "Heat Pump",
  );
  expect(getEquipmentTypeLabel(APPLIANCE_TYPE_OPTIONS, "   ")).toBe("");
});

test("non-string equipment fields are reported and blanked", () => {
  expect(
    readEquipmentFieldsFromRecord({
      equipmentType: "oven",
      make: 42,
      serialNumber: null,
    }),
  ).toEqual({
    fields: {
      equipmentType: "oven",
      make: "",
      model: "",
      serialNumber: "",
    },
    issues: [
      {
        field: "make",
        message: "Expected a string value.",
        value: 42,
      },
    ],
  });
});

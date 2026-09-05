import { expect, test } from "bun:test";
import {
  initializeStoredDocumentKind,
  readStoredDocumentState,
  writeStoredDocumentFields,
} from "@tearleads/client-sdk";
import { createDocument } from "@tearleads/loro";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../projectors";
import type { EquipmentDocumentFields } from "../shared/equipmentDocumentDefinition";
import { TOOL_TYPE_OPTIONS } from "./toolDocumentDefinition";

// The title is what names the tool in the Explorer, so assert it through the
// projector rather than the private derivation.
async function projectToolTitle(
  fields: Partial<EquipmentDocumentFields>,
): Promise<string> {
  const doc = await createDocument("tool-title");
  initializeStoredDocumentKind(doc, "tool", APP_DOCUMENT_PROJECTOR_DEFINITIONS);
  writeStoredDocumentFields(
    doc,
    "tool",
    fields,
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
  return readStoredDocumentState(doc, APP_DOCUMENT_PROJECTOR_DEFINITIONS).title;
}

test("tool fields are stored as first-class Loro state", async () => {
  const doc = await createDocument("tool-fields");

  initializeStoredDocumentKind(doc, "tool", APP_DOCUMENT_PROJECTOR_DEFINITIONS);
  writeStoredDocumentFields(
    doc,
    "tool",
    {
      equipmentType: "leaf_blower",
      make: "Ego",
      model: "LB6504",
      serialNumber: "SN-0001",
    },
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );

  expect(
    readStoredDocumentState(doc, APP_DOCUMENT_PROJECTOR_DEFINITIONS),
  ).toMatchObject({
    documentKind: "tool",
    fieldValidationIssues: [],
    structuredFields: {
      equipmentType: "leaf_blower",
      make: "Ego",
      model: "LB6504",
      serialNumber: "SN-0001",
    },
    title: "Leaf Blower Ego LB6504",
  });
});

test("the requested tool types are all in the dropdown", () => {
  const labels = TOOL_TYPE_OPTIONS.map((option) => option.label);

  expect(labels).toContain("Leaf Blower");
  expect(labels).toContain("Drill");
  expect(labels).toContain("Weed Wacker");
  expect(new Set(TOOL_TYPE_OPTIONS.map((option) => option.value)).size).toBe(
    TOOL_TYPE_OPTIONS.length,
  );
});

test("tool title degrades a step at a time", async () => {
  expect(
    await projectToolTitle({ equipmentType: "drill", make: "  DeWalt  " }),
  ).toBe("Drill DeWalt");
  expect(await projectToolTitle({ make: "DeWalt", model: "DCD771" })).toBe(
    "DeWalt DCD771",
  );
  expect(await projectToolTitle({ equipmentType: "weed_wacker" })).toBe(
    "Weed Wacker",
  );
  expect(await projectToolTitle({ serialNumber: "SN-0001" })).toBe(
    "Tool SN-0001",
  );
  expect(await projectToolTitle({})).toBe("Untitled tool");
  expect(await projectToolTitle({ make: "   " })).toBe("Untitled tool");
});

test("untitled tool documents use the kind's untitled title", async () => {
  const doc = await createDocument("untitled-tool");

  initializeStoredDocumentKind(doc, "tool", APP_DOCUMENT_PROJECTOR_DEFINITIONS);

  expect(
    readStoredDocumentState(doc, APP_DOCUMENT_PROJECTOR_DEFINITIONS),
  ).toMatchObject({
    documentKind: "tool",
    title: "Untitled tool",
  });
});

import { expect, test } from "bun:test";
import {
  DOCUMENT_TYPE_DEFINITIONS,
  getDocumentTypeDefinition,
} from "./registry";

test("document type registry covers the supported inline document kinds", () => {
  expect(
    DOCUMENT_TYPE_DEFINITIONS.map((definition) => definition.kind),
  ).toEqual(["note", "drivers_license"]);
  expect(getDocumentTypeDefinition("note").createLabel).toBe("New Note");
  expect(getDocumentTypeDefinition("drivers_license").createLabel).toBe(
    "New Driver's License",
  );
});

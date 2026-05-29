import { expect, test } from "bun:test";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "./projectors";
import {
  DOCUMENT_TYPE_DEFINITIONS,
  getDocumentTypeDefinition,
} from "./registry";

test("document type registry covers the supported inline document kinds", () => {
  expect(
    DOCUMENT_TYPE_DEFINITIONS.map((definition) => definition.kind),
  ).toEqual([
    "note",
    "contact",
    "drivers_license",
    "credit_card",
    "image",
    "audio",
    "pdf",
    "generic_file",
  ]);
  expect(
    DOCUMENT_TYPE_DEFINITIONS.map((definition) => definition.kind),
  ).toEqual(
    APP_DOCUMENT_PROJECTOR_DEFINITIONS.map((definition) => definition.kind),
  );
  expect(getDocumentTypeDefinition("note").createLabel).toBe("New Note");
  expect(getDocumentTypeDefinition("contact").createLabel).toBe("New Contact");
  expect(getDocumentTypeDefinition("drivers_license").createLabel).toBe(
    "New Driver's License",
  );
  expect(getDocumentTypeDefinition("credit_card").createLabel).toBe(
    "New Credit Card",
  );
  expect(getDocumentTypeDefinition("image").createLabel).toBe("New Image");
  expect(getDocumentTypeDefinition("audio").createLabel).toBe("New Audio");
  expect(getDocumentTypeDefinition("pdf").createLabel).toBe("New PDF");
  expect(getDocumentTypeDefinition("generic_file").createLabel).toBe(
    "New File",
  );
});

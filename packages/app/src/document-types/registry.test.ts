import { expect, test } from "bun:test";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "./projectors";
import {
  CREATABLE_DOCUMENT_TYPE_DEFINITIONS,
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
    "passport",
    "env_file",
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
  expect(getDocumentTypeDefinition("note").createLabel).toBe("Note");
  expect(getDocumentTypeDefinition("contact").createLabel).toBe("Contact");
  expect(getDocumentTypeDefinition("drivers_license").createLabel).toBe(
    "Driver's License",
  );
  expect(getDocumentTypeDefinition("credit_card").createLabel).toBe(
    "Credit Card",
  );
  expect(getDocumentTypeDefinition("passport").createLabel).toBe("Passport");
  expect(getDocumentTypeDefinition("env_file").createLabel).toBe(".env File");
  expect(getDocumentTypeDefinition("image").createLabel).toBe("Image");
  expect(getDocumentTypeDefinition("audio").createLabel).toBe("Audio");
  expect(getDocumentTypeDefinition("pdf").createLabel).toBe("PDF");
  expect(getDocumentTypeDefinition("generic_file").createLabel).toBe("File");
});

test("every document type provides a create icon", () => {
  for (const definition of DOCUMENT_TYPE_DEFINITIONS) {
    expect(definition.createIcon).toBeDefined();
  }
});

test("creatable document types exclude upload-only file kinds", () => {
  expect(
    CREATABLE_DOCUMENT_TYPE_DEFINITIONS.map((definition) => definition.kind),
  ).toEqual([
    "note",
    "contact",
    "drivers_license",
    "credit_card",
    "passport",
    "env_file",
  ]);
});

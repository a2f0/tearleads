import { expect, test } from "bun:test";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { ORGANIZATION_PROFILE_DOCUMENT_KIND } from "@tearleads/client-sdk";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  APP_DOCUMENT_TYPE_PROJECTOR_DEFINITIONS,
} from "./projectors";
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
    "blood_pressure",
    "weight",
    "json_file",
    "image",
    "audio",
    "video",
    "pdf",
    "generic_file",
  ]);
  expect(
    DOCUMENT_TYPE_DEFINITIONS.map((definition) => definition.kind),
  ).toEqual(
    APP_DOCUMENT_TYPE_PROJECTOR_DEFINITIONS.map(
      (definition) => definition.kind,
    ),
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
  expect(getDocumentTypeDefinition("blood_pressure").createLabel).toBe(
    "Blood Pressure",
  );
  expect(getDocumentTypeDefinition("weight").createLabel).toBe("Weight");
  expect(getDocumentTypeDefinition("json_file").createLabel).toBe("JSON File");
  expect(getDocumentTypeDefinition("image").createLabel).toBe("Image");
  expect(getDocumentTypeDefinition("audio").createLabel).toBe("Audio");
  expect(getDocumentTypeDefinition("video").createLabel).toBe("Video");
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
    "blood_pressure",
    "weight",
  ]);
});

test("unregistered stored Loro document kinds use a read-only fallback app", () => {
  const definition = getDocumentTypeDefinition(
    ORGANIZATION_PROFILE_DOCUMENT_KIND,
  );

  expect(definition.kind).toBe(ORGANIZATION_PROFILE_DOCUMENT_KIND);
  expect(definition.createIcon).toBe(FileIcon);
  expect(definition.createLabel).toBe("Organization profile");
  expect(definition.App).toBeDefined();
  expect(
    DOCUMENT_TYPE_DEFINITIONS.map((registered) => registered.kind),
  ).not.toContain(ORGANIZATION_PROFILE_DOCUMENT_KIND);
  expect(
    APP_DOCUMENT_PROJECTOR_DEFINITIONS.map((registered) => registered.kind),
  ).toContain(ORGANIZATION_PROFILE_DOCUMENT_KIND);
});

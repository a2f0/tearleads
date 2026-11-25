import { expect, test } from "bun:test";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import { WashingMachineIcon } from "@phosphor-icons/react/dist/csr/WashingMachine";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import { ORGANIZATION_PROFILE_DOCUMENT_KIND } from "@tearleads/client-sdk";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  APP_DOCUMENT_TYPE_PROJECTOR_DEFINITIONS,
} from "./projectors";
import {
  CREATABLE_DOCUMENT_TYPE_DEFINITIONS,
  DOCUMENT_TYPE_DEFINITIONS,
  getDocumentPhotoCapability,
  getDocumentTypeDefinition,
} from "./registry";

test("only registered document kinds opt into specialized container views", () => {
  expect(getDocumentTypeDefinition("contact").ContainerView).toBeDefined();
  expect(getDocumentTypeDefinition("note").ContainerView).toBeUndefined();
  expect(
    getDocumentTypeDefinition("unknown-kind").ContainerView,
  ).toBeUndefined();
});

test("document type registry covers the supported inline document kinds", () => {
  expect(
    DOCUMENT_TYPE_DEFINITIONS.map((definition) => definition.kind),
  ).toEqual([
    "note",
    "contact",
    "drivers_license",
    "credit_card",
    "passport",
    "birth_certificate",
    "insurance_policy",
    "env_file",
    "blood_pressure",
    "eyeglass_prescription",
    "weight",
    "tool",
    "appliance",
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
  expect(getDocumentTypeDefinition("birth_certificate").createLabel).toBe(
    "Birth Certificate",
  );
  expect(getDocumentTypeDefinition("passport").createLabel).toBe("Passport");
  expect(getDocumentTypeDefinition("insurance_policy").createLabel).toBe(
    "Insurance Policy",
  );
  expect(getDocumentTypeDefinition("env_file").createLabel).toBe(".env File");
  expect(getDocumentTypeDefinition("blood_pressure").createLabel).toBe(
    "Blood Pressure",
  );
  expect(getDocumentTypeDefinition("eyeglass_prescription").createLabel).toBe(
    "Eyeglass Prescription",
  );
  expect(getDocumentTypeDefinition("weight").createLabel).toBe("Weight");
  expect(getDocumentTypeDefinition("tool").createLabel).toBe("Tool");
  expect(getDocumentTypeDefinition("appliance").createLabel).toBe("Appliance");
  expect(getDocumentTypeDefinition("json_file").createLabel).toBe("JSON File");
  expect(getDocumentTypeDefinition("image").createLabel).toBe("Image");
  expect(getDocumentTypeDefinition("audio").createLabel).toBe("Audio");
  expect(getDocumentTypeDefinition("video").createLabel).toBe("Video");
  expect(getDocumentTypeDefinition("pdf").createLabel).toBe("PDF");
  expect(getDocumentTypeDefinition("generic_file").createLabel).toBe("File");
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
    "birth_certificate",
    "insurance_policy",
    "env_file",
    "blood_pressure",
    "eyeglass_prescription",
    "weight",
    "tool",
    "appliance",
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

test("contacts, appliances, and tools keep photos with an optional avatar, and weight has neither", () => {
  expect(getDocumentTypeDefinition("contact").photos).toEqual({
    slotId: "contact-photos",
    avatarFallbackIcon: UserIcon,
  });
  expect(getDocumentTypeDefinition("appliance").photos).toEqual({
    slotId: "equipment-photos",
    avatarFallbackIcon: WashingMachineIcon,
  });
  expect(getDocumentTypeDefinition("tool").photos).toEqual({
    slotId: "equipment-photos",
    avatarFallbackIcon: WrenchIcon,
  });
  expect(getDocumentTypeDefinition("weight").photos).toBeUndefined();
  expect(getDocumentPhotoCapability("tool")).toBe(
    getDocumentTypeDefinition("tool").photos,
  );
  expect(getDocumentPhotoCapability("weight")).toBeUndefined();
  expect(getDocumentPhotoCapability("unregistered-kind")).toBeUndefined();
});

import { expect, test } from "bun:test";
import {
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
  projectStoredDocumentState,
} from "@tearleads/client-sdk";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "./appDocumentProjectors";

function projectOrganizationProfile(name: unknown) {
  return projectStoredDocumentState(
    {
      documentKind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
      structuredFields: { name },
      text: "",
    },
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
}

test("organization profile title comes from its embedded name", () => {
  expect(projectOrganizationProfile("  Personal Org  ")).toMatchObject({
    fieldValidationIssues: [],
    structuredFields: { name: "  Personal Org  " },
    title: "Personal Org",
  });
});

test("organization profile title falls back when its name is unavailable", () => {
  expect(projectOrganizationProfile(42)).toMatchObject({
    fieldValidationIssues: [
      {
        field: "name",
        message: "Expected a string value.",
        value: 42,
      },
    ],
    title: "Organization Profile",
  });
});

import { expect, test } from "bun:test";
import {
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
  projectStoredDocumentState,
} from "@tearleads/client-sdk";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "./appDocumentProjectors";

function projectOrganizationProfile(
  structuredFields: Readonly<Record<string, unknown>>,
) {
  return projectStoredDocumentState(
    {
      documentKind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
      structuredFields,
      text: "",
    },
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
}

test("organization profile title comes from its embedded name", () => {
  expect(
    projectOrganizationProfile({ name: "  Personal Org  ", tier: "personal" }),
  ).toMatchObject({
    fieldValidationIssues: [],
    structuredFields: { name: "  Personal Org  ", tier: "personal" },
    title: "Personal Org",
  });
});

test("organization profile title falls back when its name is unavailable", () => {
  expect(projectOrganizationProfile({ name: 42 })).toMatchObject({
    fieldValidationIssues: [
      {
        field: "name",
        message: "Expected a string value.",
        value: 42,
      },
    ],
    structuredFields: { name: "" },
    title: "Organization Profile",
  });
});

test("organization profile title falls back for absent or blank names", () => {
  expect(projectOrganizationProfile({})).toMatchObject({
    fieldValidationIssues: [],
    structuredFields: {},
    title: "Organization Profile",
  });
  expect(projectOrganizationProfile({ name: "   " })).toMatchObject({
    fieldValidationIssues: [],
    structuredFields: { name: "   " },
    title: "Organization Profile",
  });
});

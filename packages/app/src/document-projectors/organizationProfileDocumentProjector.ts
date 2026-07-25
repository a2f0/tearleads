import {
  type DocumentFieldValidationIssue,
  type DocumentProjectorDefinition,
  readStringDocumentField,
  type StoredDocumentKind,
} from "@tearleads/client-sdk";

const ORGANIZATION_PROFILE_DOCUMENT_KIND =
  "organization_profile" satisfies StoredDocumentKind;
const ORGANIZATION_PROFILE_FALLBACK_TITLE = "Organization Profile";

export const organizationProfileDocumentProjectorDefinition: DocumentProjectorDefinition =
  {
    kind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
    label: "organization profile",
    project: ({ structuredFields }) => {
      const issues: DocumentFieldValidationIssue[] = [];
      const name = readStringDocumentField(structuredFields, "name", issues);

      return {
        fieldValidationIssues: issues,
        structuredFields: { name },
        title: name.trim() || ORGANIZATION_PROFILE_FALLBACK_TITLE,
      };
    },
    untitledTitle: ORGANIZATION_PROFILE_FALLBACK_TITLE,
  };

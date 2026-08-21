import {
  type DocumentFieldValidationIssue,
  type DocumentProjectorDefinition,
  readStringDocumentField,
} from "@symcrypt/client-sdk";

// Keep this stable wire value local: importing the organization workflow export
// through the SDK barrel creates a browser module-initialization cycle here.
const ORGANIZATION_PROFILE_DOCUMENT_KIND = "organization_profile";
const ORGANIZATION_PROFILE_FALLBACK_TITLE = "Organization Profile";

export const organizationProfileDocumentProjectorDefinition: DocumentProjectorDefinition =
  {
    kind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
    label: "organization profile",
    project: ({ structuredFields }) => {
      const issues: DocumentFieldValidationIssue[] = [];
      const fields: Record<string, string> & { name?: string } =
        Object.fromEntries(
          Object.keys(structuredFields).map((field) => [
            field,
            readStringDocumentField(structuredFields, field, issues),
          ]),
        );
      const name = fields.name ?? "";

      return {
        fieldValidationIssues: issues,
        structuredFields: fields,
        title: name.trim() || ORGANIZATION_PROFILE_FALLBACK_TITLE,
      };
    },
    untitledTitle: ORGANIZATION_PROFILE_FALLBACK_TITLE,
  };

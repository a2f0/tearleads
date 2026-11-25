import { PasswordIcon } from "@phosphor-icons/react/dist/csr/Password";
import {
  type DocumentFieldValidationIssue,
  type DocumentProjection,
  type DocumentProjectorInput,
  type DocumentRowSummary,
  readStringDocumentField,
  type StoredDocumentKind,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import {
  addDateOnlyFormatIssue,
  structuredFieldsProjector,
} from "../shared/documentFieldUtils";
import type { AppDocumentProjectorDefinition } from "../types";

/**
 * A password-manager entry, shaped after KeePass: the five standard fields,
 * an expiry, tags, a TOTP link, and any number of named extra attributes,
 * each optionally protected (masked). Nothing here is KeePass-specific, so
 * other password managers' exports map onto it too.
 */
export const PASSCODE_DOCUMENT_KIND = "passcode" satisfies StoredDocumentKind;

export const PASSCODE_FIELD_KEYS = [
  "title",
  "username",
  "password",
  "url",
  "notes",
  "otp",
  "tags",
  "expirationDate",
  // Where an imported passcode came from: the source entry's identifier and
  // its own creation and modification times (ISO 8601). Blank when typed in.
  "sourceId",
  "sourceCreatedAt",
  "sourceModifiedAt",
] as const;

export type PasscodeFieldKey = (typeof PASSCODE_FIELD_KEYS)[number];
export type PasscodeDocumentFields = Record<PasscodeFieldKey, string>;

/** One extra attribute row: KeePass's "Additional attributes". */
export const PASSCODE_ATTRIBUTE_NAME_FIELD = "name";
export const PASSCODE_ATTRIBUTE_VALUE_FIELD = "value";
/** "true" when the value is masked until revealed; blank otherwise. */
export const PASSCODE_ATTRIBUTE_PROTECTED_FIELD = "protected";
export const PASSCODE_ATTRIBUTE_PROTECTED = "true";

const untitledTitle = "Untitled passcode";

function readPasscodeFields(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<PasscodeDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  const read = (key: PasscodeFieldKey) =>
    readStringDocumentField(source, key, issues);
  const fields: PasscodeDocumentFields = {
    title: read("title"),
    username: read("username"),
    password: read("password"),
    url: read("url"),
    notes: read("notes"),
    otp: read("otp"),
    tags: read("tags"),
    expirationDate: read("expirationDate"),
    sourceId: read("sourceId"),
    sourceCreatedAt: read("sourceCreatedAt"),
    sourceModifiedAt: read("sourceModifiedAt"),
  };
  addDateOnlyFormatIssue(issues, "expirationDate", fields.expirationDate);
  return { fields, issues };
}

export function readPasscodeFieldValues(
  source: Readonly<Record<string, unknown>>,
): PasscodeDocumentFields {
  return readPasscodeFields(source).fields;
}

function urlHost(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) return "";
  // `new URL`, not `URL.canParse`, which WebViews before 2023 lack.
  try {
    return new URL(trimmed).hostname || trimmed;
  } catch {
    return trimmed;
  }
}

/** The title, else the site the URL names, else the username. */
function derivePasscodeTitle(fields: PasscodeDocumentFields): string {
  return (
    [fields.title, urlHost(fields.url), fields.username]
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? untitledTitle
  );
}

function addAttributeIssues(
  rows: ReadonlyArray<DocumentRowSummary> | undefined,
  issues: DocumentFieldValidationIssue[],
): void {
  (rows ?? []).forEach((row, index) => {
    const flag = row.fields[PASSCODE_ATTRIBUTE_PROTECTED_FIELD] ?? "";
    if (flag !== "" && flag !== PASSCODE_ATTRIBUTE_PROTECTED) {
      issues.push({
        field: `rows[${index}].${PASSCODE_ATTRIBUTE_PROTECTED_FIELD}`,
        message: `Expected "${PASSCODE_ATTRIBUTE_PROTECTED}" or blank.`,
        value: flag,
      });
    }
  });
}

const projectPasscodeFields = structuredFieldsProjector(
  readPasscodeFields,
  derivePasscodeTitle,
);

function projectPasscode(input: DocumentProjectorInput): DocumentProjection {
  const projection = projectPasscodeFields(input);
  const issues = [...projection.fieldValidationIssues];
  addAttributeIssues(input.rows, issues);
  return { ...projection, fieldValidationIssues: issues };
}

export const passcodeDocumentProjectorDefinition = {
  createIcon: PasswordIcon,
  createLabel: "Passcode",
  kind: PASSCODE_DOCUMENT_KIND,
  label: "passcode",
  project: projectPasscode,
  untitledTitle,
} satisfies AppDocumentProjectorDefinition;

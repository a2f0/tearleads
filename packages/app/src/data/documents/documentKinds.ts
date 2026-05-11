import type { LoroMap } from "@tearleads/loro";

export type StoredDocumentKind = "note" | "drivers_license" | "credit_card";

export interface DriverLicenseDocumentFields {
  expirationDate: string;
  licenseId: string;
}

export interface CreditCardDocumentFields {
  cardNumber: string;
  cvvCode: string;
  expirationDate: string;
  nameOnCard: string;
}

interface LegacyDriverLicenseDocument extends DriverLicenseDocumentFields {
  kind: "drivers_license";
  version: number;
}

interface LegacyCreditCardDocument extends CreditCardDocumentFields {
  kind: "credit_card";
  version: number;
}

export interface DocumentFieldValidationIssue {
  field: string;
  message: string;
  value: unknown;
}

interface ValidatedDocumentFields<TFields> {
  fields: TFields;
  issues: DocumentFieldValidationIssue[];
}

interface StoredDocumentState {
  documentKind: StoredDocumentKind;
  fieldValidationIssues: DocumentFieldValidationIssue[];
  structuredFields: Record<string, string>;
  text: string;
  title: string;
}

interface StructuredDocumentMap {
  entries: () => Array<[string, unknown]>;
  get: (key: string) => unknown;
  getOrCreateContainer: (
    key: string,
    container: LoroMap<Record<string, unknown>>,
  ) => StructuredDocumentMap;
  set: (key: string, value: string | number) => void;
}

interface StructuredDocumentText {
  toString: () => string;
}

interface StructuredDocumentShape {
  getMap: (key: string) => StructuredDocumentMap;
  getText: (key: string) => StructuredDocumentText;
}

const DOCUMENT_METADATA_MAP_KEY = "metadata";
const DOCUMENT_FIELDS_MAP_KEY = "fields";
const DOCUMENT_KIND_KEY = "kind";
const DOCUMENT_SCHEMA_VERSION_KEY = "schemaVersion";
const STRUCTURED_DOCUMENT_SCHEMA_VERSION = 1;
const LEGACY_DRIVER_LICENSE_VERSION = 1;
const LEGACY_CREDIT_CARD_VERSION = 1;

const DRIVER_LICENSE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CREDIT_CARD_EXPIRATION_PATTERN = /^\d{4}-\d{2}$/u;

function isStoredDocumentKind(value: unknown): value is StoredDocumentKind {
  return (
    value === "note" || value === "drivers_license" || value === "credit_card"
  );
}

function isStructuredDocumentKind(
  value: unknown,
): value is Exclude<StoredDocumentKind, "note"> {
  return value === "drivers_license" || value === "credit_card";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStructuredRecord(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || !trimmed.startsWith("{")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  return isRecord(parsed) ? parsed : null;
}

function getParsedRecordByKind<TKey extends string>(
  parsed: Record<string, unknown> | null,
  kind: StoredDocumentKind,
): Partial<Record<TKey, unknown>> | null {
  const record = parsed as
    | ({ kind?: unknown } & Partial<Record<TKey, unknown>>)
    | null;
  if (!record || record.kind !== kind) {
    return null;
  }

  return record;
}

function hasSupportedLegacyVersion(
  record: { readonly version?: unknown },
  minimumVersion: number,
): boolean {
  const { version } = record;
  return (
    typeof version === "number" &&
    Number.isInteger(version) &&
    version >= minimumVersion
  );
}

function getDocumentText(doc: StructuredDocumentShape): string {
  return doc.getText("text").toString();
}

function getMetadataMap(doc: StructuredDocumentShape): StructuredDocumentMap {
  return doc.getMap(DOCUMENT_METADATA_MAP_KEY);
}

function getFieldsMap(doc: StructuredDocumentShape): StructuredDocumentMap {
  return doc.getMap(DOCUMENT_FIELDS_MAP_KEY);
}

function readDocumentKind(doc: StructuredDocumentShape): StoredDocumentKind {
  const kind = getMetadataMap(doc).get(DOCUMENT_KIND_KEY);
  return isStoredDocumentKind(kind) ? kind : "note";
}

function readStructuredFields(
  doc: StructuredDocumentShape,
): Record<string, unknown> {
  return Object.fromEntries(getFieldsMap(doc).entries());
}

function readStringField(
  source: Readonly<Record<string, unknown>>,
  field: string,
  issues: DocumentFieldValidationIssue[],
): string {
  const value = source[field];
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  issues.push({
    field,
    message: "Expected a string value.",
    value,
  });
  return "";
}

function isValidDateOnly(value: string): boolean {
  if (!DRIVER_LICENSE_DATE_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  return day <= getDaysInMonth(year, month);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isValidYearMonth(value: string): boolean {
  if (!CREDIT_CARD_EXPIRATION_PATTERN.test(value)) {
    return false;
  }

  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

function addFormatIssue(
  issues: DocumentFieldValidationIssue[],
  field: string,
  value: string,
  message: string,
): void {
  if (value.length === 0) {
    return;
  }

  issues.push({
    field,
    message,
    value,
  });
}

export function getUntitledDocumentTitle(kind: StoredDocumentKind): string {
  if (kind === "drivers_license") {
    return "Untitled driver's license";
  }

  if (kind === "credit_card") {
    return "Untitled credit card";
  }

  return "Untitled note";
}

export function getStoredDocumentTypeLabel(kind: StoredDocumentKind): string {
  if (kind === "drivers_license") {
    return "driver's license";
  }

  if (kind === "credit_card") {
    return "credit card";
  }

  return "note";
}

export function readDriverLicenseFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<DriverLicenseDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  const fields = {
    expirationDate: readStringField(source, "expirationDate", issues),
    licenseId: readStringField(source, "licenseId", issues),
  };

  if (
    fields.expirationDate.length > 0 &&
    !isValidDateOnly(fields.expirationDate)
  ) {
    addFormatIssue(
      issues,
      "expirationDate",
      fields.expirationDate,
      "Expected a calendar date in YYYY-MM-DD format.",
    );
  }

  return { fields, issues };
}

export function readCreditCardFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<CreditCardDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  const fields = {
    cardNumber: readStringField(source, "cardNumber", issues),
    cvvCode: readStringField(source, "cvvCode", issues),
    expirationDate: readStringField(source, "expirationDate", issues),
    nameOnCard: readStringField(source, "nameOnCard", issues),
  };

  if (
    fields.expirationDate.length > 0 &&
    !isValidYearMonth(fields.expirationDate)
  ) {
    addFormatIssue(
      issues,
      "expirationDate",
      fields.expirationDate,
      "Expected a card expiration month in YYYY-MM format.",
    );
  }

  return { fields, issues };
}

export function readDriverLicenseDocument(
  doc: StructuredDocumentShape,
): ValidatedDocumentFields<DriverLicenseDocumentFields> {
  return readDriverLicenseFieldsFromRecord(readStructuredFields(doc));
}

export function readCreditCardDocument(
  doc: StructuredDocumentShape,
): ValidatedDocumentFields<CreditCardDocumentFields> {
  return readCreditCardFieldsFromRecord(readStructuredFields(doc));
}

function deriveNoteTitle(text: string): string {
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return getUntitledDocumentTitle("note");
}

function readLegacyStructuredDocumentState(
  text: string,
): StoredDocumentState | null {
  const parsed = parseStructuredRecord(text);
  const creditCardRecord = getParsedRecordByKind<
    keyof LegacyCreditCardDocument
  >(parsed, "credit_card");
  if (
    creditCardRecord &&
    hasSupportedLegacyVersion(creditCardRecord, LEGACY_CREDIT_CARD_VERSION)
  ) {
    return projectStoredDocumentState({
      documentKind: "credit_card",
      structuredFields: creditCardRecord,
      text,
    });
  }

  const driverLicenseRecord = getParsedRecordByKind<
    keyof LegacyDriverLicenseDocument
  >(parsed, "drivers_license");
  if (
    driverLicenseRecord &&
    hasSupportedLegacyVersion(
      driverLicenseRecord,
      LEGACY_DRIVER_LICENSE_VERSION,
    )
  ) {
    return projectStoredDocumentState({
      documentKind: "drivers_license",
      structuredFields: driverLicenseRecord,
      text,
    });
  }

  return null;
}

function deriveCreditCardTitle(fields: CreditCardDocumentFields): string {
  const digits = fields.cardNumber.replaceAll(/\D/gu, "");
  if (digits.length >= 4) {
    return `Credit Card ending in ${digits.slice(-4)}`;
  }

  const trimmedNameOnCard = fields.nameOnCard.trim();
  return trimmedNameOnCard.length > 0
    ? `Credit Card ${trimmedNameOnCard}`
    : getUntitledDocumentTitle("credit_card");
}

function deriveDriverLicenseTitle(fields: DriverLicenseDocumentFields): string {
  const trimmedLicenseId = fields.licenseId.trim();
  return trimmedLicenseId.length > 0
    ? `Driver's License ${trimmedLicenseId}`
    : getUntitledDocumentTitle("drivers_license");
}

export function deriveStoredDocumentKind(text: string): StoredDocumentKind {
  return readLegacyStructuredDocumentState(text)?.documentKind ?? "note";
}

export function deriveStoredDocumentTitle(text: string): string {
  return (
    readLegacyStructuredDocumentState(text)?.title ?? deriveNoteTitle(text)
  );
}

export function projectStoredDocumentState(input: {
  documentKind: StoredDocumentKind;
  structuredFields: Readonly<Record<string, unknown>>;
  text: string;
}): StoredDocumentState {
  if (input.documentKind === "drivers_license") {
    const validated = readDriverLicenseFieldsFromRecord(input.structuredFields);
    return {
      documentKind: input.documentKind,
      fieldValidationIssues: validated.issues,
      structuredFields: { ...validated.fields },
      text: input.text,
      title: deriveDriverLicenseTitle(validated.fields),
    };
  }

  if (input.documentKind === "credit_card") {
    const validated = readCreditCardFieldsFromRecord(input.structuredFields);
    return {
      documentKind: input.documentKind,
      fieldValidationIssues: validated.issues,
      structuredFields: { ...validated.fields },
      text: input.text,
      title: deriveCreditCardTitle(validated.fields),
    };
  }

  return {
    documentKind: "note",
    fieldValidationIssues: [],
    structuredFields: {},
    text: input.text,
    title: deriveNoteTitle(input.text),
  };
}

export function readStoredDocumentState(
  doc: StructuredDocumentShape,
): StoredDocumentState {
  const documentKind = readDocumentKind(doc);
  const text = getDocumentText(doc);
  if (documentKind === "note") {
    const legacyState = readLegacyStructuredDocumentState(text);
    if (legacyState) {
      return legacyState;
    }
  }

  const structuredFields = isStructuredDocumentKind(documentKind)
    ? readStructuredFields(doc)
    : {};

  return projectStoredDocumentState({
    documentKind,
    structuredFields,
    text,
  });
}

export function initializeStoredDocumentKind(
  doc: StructuredDocumentShape,
  kind: StoredDocumentKind,
): void {
  if (!isStructuredDocumentKind(kind)) {
    return;
  }

  const metadata = getMetadataMap(doc);
  metadata.set(DOCUMENT_KIND_KEY, kind);
  metadata.set(DOCUMENT_SCHEMA_VERSION_KEY, STRUCTURED_DOCUMENT_SCHEMA_VERSION);
  getFieldsMap(doc);
}

export function writeStoredDocumentFields(
  doc: StructuredDocumentShape,
  kind: Exclude<StoredDocumentKind, "note">,
  patch: Partial<DriverLicenseDocumentFields & CreditCardDocumentFields>,
): void {
  initializeStoredDocumentKind(doc, kind);
  const fields = getFieldsMap(doc);

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    fields.set(key, value);
  }
}

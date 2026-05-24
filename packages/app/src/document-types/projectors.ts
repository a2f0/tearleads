import {
  createDocumentProjectorRegistry,
  type DocumentClientProjectionDefinition,
  type DocumentFieldValidationIssue,
  type DocumentProjectorDefinition,
  readStringDocumentField,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk/documents";
import type { SqlTableSchema } from "@tearleads/client-sdk/sqlite";

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

export interface ContactDocumentFields {
  encapsulationPublicKey: string;
  firstName: string;
  isSelf: string;
  lastName: string;
  userId: string;
}

interface AppDocumentProjectorDefinition extends DocumentProjectorDefinition {
  createLabel: string;
}

const DRIVER_LICENSE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CREDIT_CARD_EXPIRATION_PATTERN = /^\d{4}-\d{2}$/u;

const DRIVER_LICENSE_PROJECTION_TABLE: SqlTableSchema = {
  name: "driver_license_projection",
  createSql: `CREATE TABLE IF NOT EXISTS "driver_license_projection" (
  "local_id" TEXT PRIMARY KEY,
  "document_id" TEXT,
  "container_id" TEXT,
  "license_id" TEXT NOT NULL DEFAULT '',
  "expiration_date" TEXT NOT NULL DEFAULT '',
  "updated_at" TEXT NOT NULL
)`,
  indexes: [
    `CREATE INDEX IF NOT EXISTS "driver_license_projection_expiration_idx" ON "driver_license_projection" ("expiration_date")`,
  ],
};

const CREDIT_CARD_PROJECTION_TABLE: SqlTableSchema = {
  name: "credit_card_projection",
  createSql: `CREATE TABLE IF NOT EXISTS "credit_card_projection" (
  "local_id" TEXT PRIMARY KEY,
  "document_id" TEXT,
  "container_id" TEXT,
  "card_last4" TEXT,
  "expiration_date" TEXT NOT NULL DEFAULT '',
  "name_on_card" TEXT NOT NULL DEFAULT '',
  "updated_at" TEXT NOT NULL
)`,
  indexes: [
    `CREATE INDEX IF NOT EXISTS "credit_card_projection_expiration_idx" ON "credit_card_projection" ("expiration_date")`,
  ],
};

const CONTACT_PROJECTION_TABLE: SqlTableSchema = {
  name: "contact_projection",
  createSql: `CREATE TABLE IF NOT EXISTS "contact_projection" (
  "local_id" TEXT PRIMARY KEY,
  "document_id" TEXT,
  "container_id" TEXT,
  "first_name" TEXT NOT NULL DEFAULT '',
  "last_name" TEXT NOT NULL DEFAULT '',
  "user_id" TEXT,
  "encapsulation_public_key" TEXT,
  "is_self" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TEXT NOT NULL
)`,
  indexes: [
    `CREATE UNIQUE INDEX IF NOT EXISTS "contact_projection_self_idx" ON "contact_projection" ("is_self") WHERE "is_self" = 1`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "contact_projection_user_idx" ON "contact_projection" ("user_id") WHERE "user_id" IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS "contact_projection_name_idx" ON "contact_projection" ("last_name" COLLATE NOCASE, "first_name" COLLATE NOCASE, "user_id" COLLATE NOCASE, "local_id" COLLATE NOCASE)`,
  ],
};

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isValidDateOnly(value: string): boolean {
  if (!DRIVER_LICENSE_DATE_PATTERN.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  return day <= getDaysInMonth(year, month);
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

function deriveNoteTitle(text: string): string {
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return "Untitled note";
}

function deriveCreditCardTitle(fields: CreditCardDocumentFields): string {
  const digits = fields.cardNumber.replaceAll(/\D/gu, "");
  if (digits.length >= 4) {
    return `Credit Card ending in ${digits.slice(-4)}`;
  }

  const trimmedNameOnCard = fields.nameOnCard.trim();
  return trimmedNameOnCard.length > 0
    ? `Credit Card ${trimmedNameOnCard}`
    : "Untitled credit card";
}

function deriveDriverLicenseTitle(fields: DriverLicenseDocumentFields): string {
  const trimmedLicenseId = fields.licenseId.trim();
  return trimmedLicenseId.length > 0
    ? `Driver's License ${trimmedLicenseId}`
    : "Untitled driver's license";
}

function deriveContactTitle(fields: ContactDocumentFields): string {
  const fullName = `${fields.firstName} ${fields.lastName}`.trim();
  if (fullName.length > 0) {
    return fullName;
  }

  return fields.userId.trim() || "Untitled contact";
}

function nullableField(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isTruthyStructuredField(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

async function deleteFromProjectionTable(input: {
  localId: string;
  tableName: string;
  execSql: Parameters<
    NonNullable<DocumentClientProjectionDefinition["delete"]>
  >[0]["execSql"];
}): Promise<void> {
  await input.execSql(`DELETE FROM "${input.tableName}" WHERE "local_id" = ?`, [
    input.localId,
  ]);
}

const driverLicenseClientProjection: DocumentClientProjectionDefinition = {
  tables: [DRIVER_LICENSE_PROJECTION_TABLE],
  async save(input) {
    const fields = readDriverLicenseFieldsFromRecord(
      input.structuredFields,
    ).fields;
    await input.execSql(
      `INSERT INTO "driver_license_projection" (
        "local_id",
        "document_id",
        "container_id",
        "license_id",
        "expiration_date",
        "updated_at"
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT("local_id") DO UPDATE SET
        "document_id" = excluded."document_id",
        "container_id" = excluded."container_id",
        "license_id" = excluded."license_id",
        "expiration_date" = excluded."expiration_date",
        "updated_at" = excluded."updated_at"`,
      [
        input.localId,
        input.documentId,
        input.containerId,
        fields.licenseId,
        fields.expirationDate,
        input.updatedAt,
      ],
    );
  },
  delete: (input) =>
    deleteFromProjectionTable({
      execSql: input.execSql,
      localId: input.localId,
      tableName: DRIVER_LICENSE_PROJECTION_TABLE.name,
    }),
};

const creditCardClientProjection: DocumentClientProjectionDefinition = {
  tables: [CREDIT_CARD_PROJECTION_TABLE],
  async save(input) {
    const fields = readCreditCardFieldsFromRecord(
      input.structuredFields,
    ).fields;
    const digits = fields.cardNumber.replaceAll(/\D/gu, "");
    await input.execSql(
      `INSERT INTO "credit_card_projection" (
        "local_id",
        "document_id",
        "container_id",
        "card_last4",
        "expiration_date",
        "name_on_card",
        "updated_at"
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT("local_id") DO UPDATE SET
        "document_id" = excluded."document_id",
        "container_id" = excluded."container_id",
        "card_last4" = excluded."card_last4",
        "expiration_date" = excluded."expiration_date",
        "name_on_card" = excluded."name_on_card",
        "updated_at" = excluded."updated_at"`,
      [
        input.localId,
        input.documentId,
        input.containerId,
        digits.length >= 4 ? digits.slice(-4) : null,
        fields.expirationDate,
        fields.nameOnCard,
        input.updatedAt,
      ],
    );
  },
  delete: (input) =>
    deleteFromProjectionTable({
      execSql: input.execSql,
      localId: input.localId,
      tableName: CREDIT_CARD_PROJECTION_TABLE.name,
    }),
};

const contactClientProjection: DocumentClientProjectionDefinition = {
  tables: [CONTACT_PROJECTION_TABLE],
  async save(input) {
    const fields = readContactFieldsFromRecord(input.structuredFields).fields;
    await input.execSql(
      `INSERT INTO "contact_projection" (
        "local_id",
        "document_id",
        "container_id",
        "first_name",
        "last_name",
        "user_id",
        "encapsulation_public_key",
        "is_self",
        "updated_at"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT("local_id") DO UPDATE SET
        "document_id" = excluded."document_id",
        "container_id" = excluded."container_id",
        "first_name" = excluded."first_name",
        "last_name" = excluded."last_name",
        "user_id" = excluded."user_id",
        "encapsulation_public_key" = excluded."encapsulation_public_key",
        "is_self" = excluded."is_self",
        "updated_at" = excluded."updated_at"`,
      [
        input.localId,
        input.documentId,
        input.containerId,
        fields.firstName,
        fields.lastName,
        nullableField(fields.userId),
        nullableField(fields.encapsulationPublicKey),
        isTruthyStructuredField(fields.isSelf) ? 1 : 0,
        input.updatedAt,
      ],
    );
  },
  delete: (input) =>
    deleteFromProjectionTable({
      execSql: input.execSql,
      localId: input.localId,
      tableName: CONTACT_PROJECTION_TABLE.name,
    }),
};

export function readDriverLicenseFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<DriverLicenseDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  const fields = {
    expirationDate: readStringDocumentField(source, "expirationDate", issues),
    licenseId: readStringDocumentField(source, "licenseId", issues),
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
    cardNumber: readStringDocumentField(source, "cardNumber", issues),
    cvvCode: readStringDocumentField(source, "cvvCode", issues),
    expirationDate: readStringDocumentField(source, "expirationDate", issues),
    nameOnCard: readStringDocumentField(source, "nameOnCard", issues),
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

export function readContactFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<ContactDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  return {
    fields: {
      encapsulationPublicKey: readStringDocumentField(
        source,
        "encapsulationPublicKey",
        issues,
      ),
      firstName: readStringDocumentField(source, "firstName", issues),
      isSelf: readStringDocumentField(source, "isSelf", issues),
      lastName: readStringDocumentField(source, "lastName", issues),
      userId: readStringDocumentField(source, "userId", issues),
    },
    issues,
  };
}

export const APP_DOCUMENT_PROJECTOR_DEFINITIONS: ReadonlyArray<AppDocumentProjectorDefinition> =
  [
    {
      createLabel: "New Note",
      kind: "note",
      label: "note",
      project: ({ text }) => ({
        fieldValidationIssues: [],
        structuredFields: {},
        title: deriveNoteTitle(text),
      }),
      untitledTitle: "Untitled note",
    },
    {
      clientProjection: contactClientProjection,
      createLabel: "New Contact",
      kind: "contact",
      label: "contact",
      project: ({ structuredFields }) => {
        const validated = readContactFieldsFromRecord(structuredFields);
        return {
          fieldValidationIssues: validated.issues,
          structuredFields: { ...validated.fields },
          title: deriveContactTitle(validated.fields),
        };
      },
      untitledTitle: "Untitled contact",
    },
    {
      clientProjection: driverLicenseClientProjection,
      createLabel: "New Driver's License",
      kind: "drivers_license",
      label: "driver's license",
      project: ({ structuredFields }) => {
        const validated = readDriverLicenseFieldsFromRecord(structuredFields);
        return {
          fieldValidationIssues: validated.issues,
          structuredFields: { ...validated.fields },
          title: deriveDriverLicenseTitle(validated.fields),
        };
      },
      untitledTitle: "Untitled driver's license",
    },
    {
      clientProjection: creditCardClientProjection,
      createLabel: "New Credit Card",
      kind: "credit_card",
      label: "credit card",
      project: ({ structuredFields }) => {
        const validated = readCreditCardFieldsFromRecord(structuredFields);
        return {
          fieldValidationIssues: validated.issues,
          structuredFields: { ...validated.fields },
          title: deriveCreditCardTitle(validated.fields),
        };
      },
      untitledTitle: "Untitled credit card",
    },
  ];

export const APP_DOCUMENT_PROJECTOR_REGISTRY = createDocumentProjectorRegistry(
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
);

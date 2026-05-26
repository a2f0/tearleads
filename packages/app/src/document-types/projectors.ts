import {
  type DocumentClientProjectionDefinition,
  type DocumentFieldValidationIssue,
  type DocumentProjectorDefinition,
  readStringDocumentField,
  type StoredDocumentKind,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import {
  defineSqlTableSchema,
  getSQLitePersistenceRuntime,
} from "@tearleads/client-sdk/sqlite";
import { eq, sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
  nickname: string;
  userId: string;
}

interface AppDocumentProjectorDefinition extends DocumentProjectorDefinition {
  createLabel: string;
}

const DRIVER_LICENSE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CREDIT_CARD_EXPIRATION_PATTERN = /^\d{4}-\d{2}$/u;
export const APP_DEFAULT_DOCUMENT_KIND = "note" satisfies StoredDocumentKind;

const driverLicenseProjection = sqliteTable(
  "driver_license_projection",
  {
    localId: text("local_id").primaryKey(),
    documentId: text("document_id"),
    containerId: text("container_id"),
    licenseId: text("license_id").notNull().default(""),
    expirationDate: text("expiration_date").notNull().default(""),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("driver_license_projection_expiration_idx").on(table.expirationDate),
  ],
);

const creditCardProjection = sqliteTable(
  "credit_card_projection",
  {
    localId: text("local_id").primaryKey(),
    documentId: text("document_id"),
    containerId: text("container_id"),
    cardLast4: text("card_last4"),
    expirationDate: text("expiration_date").notNull().default(""),
    nameOnCard: text("name_on_card").notNull().default(""),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("credit_card_projection_expiration_idx").on(table.expirationDate),
  ],
);

export const contactProjection = sqliteTable(
  "contact_projection",
  {
    localId: text("local_id").primaryKey(),
    documentId: text("document_id"),
    containerId: text("container_id"),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    nickname: text("nickname").notNull().default(""),
    userId: text("user_id"),
    encapsulationPublicKey: text("encapsulation_public_key"),
    isSelf: integer("is_self").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("contact_projection_self_idx")
      .on(table.isSelf)
      .where(sql`${table.isSelf} = 1`),
    uniqueIndex("contact_projection_user_idx")
      .on(table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    index("contact_projection_container_idx").on(table.containerId),
  ],
);

const DRIVER_LICENSE_PROJECTION_TABLE = defineSqlTableSchema(
  driverLicenseProjection,
);
const CREDIT_CARD_PROJECTION_TABLE = defineSqlTableSchema(creditCardProjection);
const CONTACT_PROJECTION_TABLE = defineSqlTableSchema(contactProjection);

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
  const nickname = fields.nickname.trim();
  if (nickname.length > 0) {
    return nickname;
  }

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

const driverLicenseClientProjection: DocumentClientProjectionDefinition = {
  tables: [DRIVER_LICENSE_PROJECTION_TABLE],
  async save(input) {
    const fields = readDriverLicenseFieldsFromRecord(
      input.structuredFields,
    ).fields;
    const row = {
      localId: input.localId,
      documentId: input.documentId,
      containerId: input.containerId,
      licenseId: fields.licenseId,
      expirationDate: fields.expirationDate,
      updatedAt: input.updatedAt,
    };

    await getSQLitePersistenceRuntime(input.execSql).runMutation(async (db) => {
      await db
        .insert(driverLicenseProjection)
        .values(row)
        .onConflictDoUpdate({
          target: driverLicenseProjection.localId,
          set: row,
        })
        .run();
    });
  },
  async delete(input) {
    await getSQLitePersistenceRuntime(input.execSql).runMutation(async (db) => {
      await db
        .delete(driverLicenseProjection)
        .where(eq(driverLicenseProjection.localId, input.localId))
        .run();
    });
  },
};

const creditCardClientProjection: DocumentClientProjectionDefinition = {
  tables: [CREDIT_CARD_PROJECTION_TABLE],
  async save(input) {
    const fields = readCreditCardFieldsFromRecord(
      input.structuredFields,
    ).fields;
    const digits = fields.cardNumber.replaceAll(/\D/gu, "");
    const row = {
      localId: input.localId,
      documentId: input.documentId,
      containerId: input.containerId,
      cardLast4: digits.length >= 4 ? digits.slice(-4) : null,
      expirationDate: fields.expirationDate,
      nameOnCard: fields.nameOnCard,
      updatedAt: input.updatedAt,
    };

    await getSQLitePersistenceRuntime(input.execSql).runMutation(async (db) => {
      await db
        .insert(creditCardProjection)
        .values(row)
        .onConflictDoUpdate({
          target: creditCardProjection.localId,
          set: row,
        })
        .run();
    });
  },
  async delete(input) {
    await getSQLitePersistenceRuntime(input.execSql).runMutation(async (db) => {
      await db
        .delete(creditCardProjection)
        .where(eq(creditCardProjection.localId, input.localId))
        .run();
    });
  },
};

const contactClientProjection: DocumentClientProjectionDefinition = {
  tables: [CONTACT_PROJECTION_TABLE],
  async save(input) {
    const fields = readContactFieldsFromRecord(input.structuredFields).fields;
    const row = {
      localId: input.localId,
      documentId: input.documentId,
      containerId: input.containerId,
      firstName: fields.firstName,
      lastName: fields.lastName,
      nickname: fields.nickname,
      userId: nullableField(fields.userId),
      encapsulationPublicKey: nullableField(fields.encapsulationPublicKey),
      isSelf: isTruthyStructuredField(fields.isSelf) ? 1 : 0,
      updatedAt: input.updatedAt,
    };

    await getSQLitePersistenceRuntime(input.execSql).runMutation(async (db) => {
      await db
        .insert(contactProjection)
        .values(row)
        .onConflictDoUpdate({
          target: contactProjection.localId,
          set: row,
        })
        .run();
    });
  },
  async delete(input) {
    await getSQLitePersistenceRuntime(input.execSql).runMutation(async (db) => {
      await db
        .delete(contactProjection)
        .where(eq(contactProjection.localId, input.localId))
        .run();
    });
  },
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
      nickname: readStringDocumentField(source, "nickname", issues),
      userId: readStringDocumentField(source, "userId", issues),
    },
    issues,
  };
}

export const APP_DOCUMENT_PROJECTOR_DEFINITIONS: ReadonlyArray<AppDocumentProjectorDefinition> =
  [
    {
      createLabel: "New Note",
      kind: APP_DEFAULT_DOCUMENT_KIND,
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

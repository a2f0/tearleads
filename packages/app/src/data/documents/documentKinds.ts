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

interface SerializedDriverLicenseDocument extends DriverLicenseDocumentFields {
  kind: "drivers_license";
  version: number;
}

interface SerializedCreditCardDocument extends CreditCardDocumentFields {
  kind: "credit_card";
  version: number;
}

type DriverLicenseRecord = Partial<
  Record<keyof SerializedDriverLicenseDocument, unknown>
>;
type CreditCardRecord = Partial<
  Record<keyof SerializedCreditCardDocument, unknown>
>;

const DRIVER_LICENSE_VERSION = 1;
const CREDIT_CARD_VERSION = 1;

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

function getDriverLicenseRecord(text: string): DriverLicenseRecord | null {
  return getParsedRecordByKind<keyof SerializedDriverLicenseDocument>(
    parseStructuredRecord(text),
    "drivers_license",
  );
}

function getCreditCardRecord(text: string): CreditCardRecord | null {
  return getParsedRecordByKind<keyof SerializedCreditCardDocument>(
    parseStructuredRecord(text),
    "credit_card",
  );
}

function parseDriverLicensePayloadRecord(
  record: DriverLicenseRecord | null,
): SerializedDriverLicenseDocument | null {
  if (!record) {
    return null;
  }

  const version = record.version;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < DRIVER_LICENSE_VERSION
  ) {
    return null;
  }

  return {
    expirationDate:
      typeof record.expirationDate === "string" ? record.expirationDate : "",
    kind: "drivers_license",
    licenseId: typeof record.licenseId === "string" ? record.licenseId : "",
    version,
  };
}

function parseCreditCardPayloadRecord(
  record: CreditCardRecord | null,
): SerializedCreditCardDocument | null {
  if (!record) {
    return null;
  }

  const version = record.version;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < CREDIT_CARD_VERSION
  ) {
    return null;
  }

  return {
    cardNumber: typeof record.cardNumber === "string" ? record.cardNumber : "",
    cvvCode: typeof record.cvvCode === "string" ? record.cvvCode : "",
    expirationDate:
      typeof record.expirationDate === "string" ? record.expirationDate : "",
    kind: "credit_card",
    nameOnCard: typeof record.nameOnCard === "string" ? record.nameOnCard : "",
    version,
  };
}

function parseDriverLicensePayload(
  text: string,
): SerializedDriverLicenseDocument | null {
  return parseDriverLicensePayloadRecord(getDriverLicenseRecord(text));
}

function parseCreditCardPayload(
  text: string,
): SerializedCreditCardDocument | null {
  return parseCreditCardPayloadRecord(getCreditCardRecord(text));
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

export function deriveStoredDocumentKind(text: string): StoredDocumentKind {
  const parsed = parseStructuredRecord(text);
  if (
    getParsedRecordByKind<keyof SerializedCreditCardDocument>(
      parsed,
      "credit_card",
    )
  ) {
    return "credit_card";
  }

  return getParsedRecordByKind<keyof SerializedDriverLicenseDocument>(
    parsed,
    "drivers_license",
  )
    ? "drivers_license"
    : "note";
}

export function parseDriverLicenseDocument(
  text: string,
): DriverLicenseDocumentFields | null {
  const parsed = parseDriverLicensePayload(text);
  if (!parsed) {
    return null;
  }

  return {
    expirationDate: parsed.expirationDate,
    licenseId: parsed.licenseId,
  };
}

export function parseCreditCardDocument(
  text: string,
): CreditCardDocumentFields | null {
  const parsed = parseCreditCardPayload(text);
  if (!parsed) {
    return null;
  }

  return {
    cardNumber: parsed.cardNumber,
    cvvCode: parsed.cvvCode,
    expirationDate: parsed.expirationDate,
    nameOnCard: parsed.nameOnCard,
  };
}

export function serializeDriverLicenseDocument(
  fields: DriverLicenseDocumentFields,
): string {
  return JSON.stringify(
    {
      expirationDate: fields.expirationDate,
      kind: "drivers_license",
      licenseId: fields.licenseId,
      version: DRIVER_LICENSE_VERSION,
    } satisfies SerializedDriverLicenseDocument,
    null,
    2,
  );
}

export function serializeCreditCardDocument(
  fields: CreditCardDocumentFields,
): string {
  return JSON.stringify(
    {
      cardNumber: fields.cardNumber,
      cvvCode: fields.cvvCode,
      expirationDate: fields.expirationDate,
      kind: "credit_card",
      nameOnCard: fields.nameOnCard,
      version: CREDIT_CARD_VERSION,
    } satisfies SerializedCreditCardDocument,
    null,
    2,
  );
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

export function deriveStoredDocumentTitle(text: string): string {
  const parsed = parseStructuredRecord(text);
  const creditCardRecord = getParsedRecordByKind<
    keyof SerializedCreditCardDocument
  >(parsed, "credit_card");
  const creditCard = parseCreditCardPayloadRecord(creditCardRecord);
  if (creditCard) {
    return deriveCreditCardTitle(creditCard);
  }

  if (creditCardRecord) {
    return "Unsupported credit card";
  }

  const driverLicenseRecord = getParsedRecordByKind<
    keyof SerializedDriverLicenseDocument
  >(parsed, "drivers_license");
  const driverLicense = parseDriverLicensePayloadRecord(driverLicenseRecord);
  if (driverLicense) {
    const trimmedLicenseId = driverLicense.licenseId.trim();
    return trimmedLicenseId.length > 0
      ? `Driver's License ${trimmedLicenseId}`
      : getUntitledDocumentTitle("drivers_license");
  }

  if (driverLicenseRecord) {
    return "Unsupported driver's license";
  }

  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return getUntitledDocumentTitle("note");
}

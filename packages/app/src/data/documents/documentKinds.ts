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

function getDriverLicenseRecord(
  text: string,
): Partial<
  Record<"expirationDate" | "kind" | "licenseId" | "version", unknown>
> | null {
  const parsed = parseStructuredRecord(text);
  if (!parsed) {
    return null;
  }

  const record = parsed as Partial<
    Record<"expirationDate" | "kind" | "licenseId" | "version", unknown>
  >;
  if (record.kind !== "drivers_license") {
    return null;
  }

  return record;
}

function getCreditCardRecord(
  text: string,
): Partial<
  Record<
    | "cardNumber"
    | "cvvCode"
    | "expirationDate"
    | "kind"
    | "nameOnCard"
    | "version",
    unknown
  >
> | null {
  const parsed = parseStructuredRecord(text);
  if (!parsed) {
    return null;
  }

  const record = parsed as Partial<
    Record<
      | "cardNumber"
      | "cvvCode"
      | "expirationDate"
      | "kind"
      | "nameOnCard"
      | "version",
      unknown
    >
  >;
  if (record.kind !== "credit_card") {
    return null;
  }

  return record;
}

function parseDriverLicensePayload(
  text: string,
): SerializedDriverLicenseDocument | null {
  const record = getDriverLicenseRecord(text);
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

function parseCreditCardPayload(
  text: string,
): SerializedCreditCardDocument | null {
  const record = getCreditCardRecord(text);
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
  if (getCreditCardRecord(text)) {
    return "credit_card";
  }

  return getDriverLicenseRecord(text) ? "drivers_license" : "note";
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
  const creditCard = parseCreditCardDocument(text);
  if (creditCard) {
    return deriveCreditCardTitle(creditCard);
  }

  if (getCreditCardRecord(text)) {
    return "Unsupported credit card";
  }

  const driverLicense = parseDriverLicenseDocument(text);
  if (driverLicense) {
    const trimmedLicenseId = driverLicense.licenseId.trim();
    return trimmedLicenseId.length > 0
      ? `Driver's License ${trimmedLicenseId}`
      : getUntitledDocumentTitle("drivers_license");
  }

  if (getDriverLicenseRecord(text)) {
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

export type StoredDocumentKind = "note" | "drivers_license";

export interface DriverLicenseDocumentFields {
  expirationDate: string;
  licenseId: string;
}

interface SerializedDriverLicenseDocument extends DriverLicenseDocumentFields {
  kind: "drivers_license";
  version: 1;
}

const DRIVER_LICENSE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseDriverLicensePayload(
  text: string,
): SerializedDriverLicenseDocument | null {
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

  if (!isRecord(parsed)) {
    return null;
  }

  const record = parsed as Partial<
    Record<"expirationDate" | "kind" | "licenseId" | "version", unknown>
  >;
  if (record.kind !== "drivers_license") {
    return null;
  }

  const version = record.version;
  if (version !== DRIVER_LICENSE_VERSION) {
    return null;
  }

  return {
    expirationDate:
      typeof record.expirationDate === "string" ? record.expirationDate : "",
    kind: "drivers_license",
    licenseId: typeof record.licenseId === "string" ? record.licenseId : "",
    version: DRIVER_LICENSE_VERSION,
  };
}

export function getUntitledDocumentTitle(kind: StoredDocumentKind): string {
  return kind === "drivers_license"
    ? "Untitled driver's license"
    : "Untitled note";
}

export function getStoredDocumentDisplayName(kind: StoredDocumentKind): string {
  return kind === "drivers_license" ? "Driver's License" : "Note";
}

export function getStoredDocumentTypeLabel(kind: StoredDocumentKind): string {
  return kind === "drivers_license" ? "driver's license" : "note";
}

export function deriveStoredDocumentKind(text: string): StoredDocumentKind {
  return parseDriverLicensePayload(text) ? "drivers_license" : "note";
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

export function deriveStoredDocumentTitle(text: string): string {
  const driverLicense = parseDriverLicenseDocument(text);
  if (driverLicense) {
    const trimmedLicenseId = driverLicense.licenseId.trim();
    return trimmedLicenseId.length > 0
      ? `Driver's License ${trimmedLicenseId}`
      : getUntitledDocumentTitle("drivers_license");
  }

  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return getUntitledDocumentTitle("note");
}

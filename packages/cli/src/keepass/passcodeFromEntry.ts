import type { KeepassEntry } from "@tearleads/keepass";
import {
  PASSCODE_ATTRIBUTE_NAME_FIELD,
  PASSCODE_ATTRIBUTE_PROTECTED,
  PASSCODE_ATTRIBUTE_PROTECTED_FIELD,
  PASSCODE_ATTRIBUTE_VALUE_FIELD,
  type PasscodeDocumentFields,
} from "app/passcode";

/** KeePassXC keeps an entry's TOTP setup as this custom field. */
const KEEPASS_OTP_FIELD = "otp";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * KeePass expires at an instant; a passcode expires on a UTC date. A year
 * past 9999 (`+010000-...`) has no date-field form, so it reads as no expiry
 * rather than an invalid field that would refuse the whole passcode.
 */
function expirationDate(expiresAt: string | null): string {
  const date = expiresAt?.slice(0, 10) ?? "";
  return DATE_ONLY.test(date) ? date : "";
}

export interface PasscodeContent {
  /** Only the fields with a value; blank ones are left unwritten. */
  readonly fields: Partial<PasscodeDocumentFields>;
  /** One row per extra attribute, in KeePass's order. */
  readonly rows: ReadonlyArray<Readonly<Record<string, string>>>;
}

function nonBlank(
  fields: PasscodeDocumentFields,
): Partial<PasscodeDocumentFields> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value.length > 0),
  );
}

/** Maps one KeePass entry onto a passcode's fields and attribute rows. */
export function passcodeFromEntry(entry: KeepassEntry): PasscodeContent {
  const otp = entry.customFields.find(
    (field) => field.name === KEEPASS_OTP_FIELD,
  );
  const attributes = entry.customFields.filter((field) => field !== otp);
  return {
    fields: nonBlank({
      title: entry.title,
      username: entry.username,
      password: entry.password,
      url: entry.url,
      notes: entry.notes,
      otp: otp?.value ?? "",
      tags: entry.tags.join(", "),
      expirationDate: expirationDate(entry.expiresAt),
      sourceId: `keepass:${entry.id}`,
      sourceCreatedAt: entry.createdAt ?? "",
      sourceModifiedAt: entry.modifiedAt ?? "",
    }),
    rows: attributes.map((field) => ({
      [PASSCODE_ATTRIBUTE_NAME_FIELD]: field.name,
      [PASSCODE_ATTRIBUTE_VALUE_FIELD]: field.value,
      ...(field.protected
        ? { [PASSCODE_ATTRIBUTE_PROTECTED_FIELD]: PASSCODE_ATTRIBUTE_PROTECTED }
        : {}),
    })),
  };
}

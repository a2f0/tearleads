import type { DocumentRow } from "@tearleads/client-sdk";
import {
  PASSCODE_ATTRIBUTE_NAME_FIELD,
  PASSCODE_ATTRIBUTE_PROTECTED,
  PASSCODE_ATTRIBUTE_PROTECTED_FIELD,
  PASSCODE_ATTRIBUTE_VALUE_FIELD,
} from "./passcodeDocumentDefinition";

/** One of KeePass's "Additional attributes", read from a document row. */
export interface PasscodeAttribute {
  readonly id: string;
  readonly isProtected: boolean;
  readonly name: string;
  readonly value: string;
}

type ReadCell = (id: string, field: string, storeValue: string) => string;

export function toPasscodeAttributes(
  rows: ReadonlyArray<DocumentRow>,
  readCell: ReadCell,
): PasscodeAttribute[] {
  return rows.map((row) => {
    const cell = (field: string) =>
      readCell(row.id, field, row.fields[field] ?? "");
    return {
      id: row.id,
      isProtected:
        cell(PASSCODE_ATTRIBUTE_PROTECTED_FIELD) ===
        PASSCODE_ATTRIBUTE_PROTECTED,
      name: cell(PASSCODE_ATTRIBUTE_NAME_FIELD),
      value: cell(PASSCODE_ATTRIBUTE_VALUE_FIELD),
    };
  });
}

/** The attribute's name, or its position when it has none. */
export function passcodeAttributeLabel(
  attribute: Pick<PasscodeAttribute, "name">,
  index: number,
): string {
  const name = attribute.name.trim();
  return name.length > 0 ? name : `Attribute ${index + 1}`;
}

/**
 * The cells of a newly added attribute, named after its position, or the next
 * number no other attribute uses (after a removal, the position can be taken).
 */
export function newPasscodeAttributeCells(
  existing: ReadonlyArray<Pick<PasscodeAttribute, "name">>,
): Record<string, string> {
  const names = new Set(existing.map(({ name }) => name.trim()));
  let number = existing.length + 1;
  while (names.has(`Attribute ${number}`)) number++;
  return {
    [PASSCODE_ATTRIBUTE_NAME_FIELD]: `Attribute ${number}`,
    [PASSCODE_ATTRIBUTE_PROTECTED_FIELD]: "",
    [PASSCODE_ATTRIBUTE_VALUE_FIELD]: "",
  };
}

/** "Never" when no expiry is set; a past date is marked as expired. */
export function formatPasscodeExpiry(
  expirationDate: string,
  today: string,
): string {
  const date = expirationDate.trim();
  if (date.length === 0) {
    return "Never";
  }
  return date < today ? `${date} (expired)` : date;
}

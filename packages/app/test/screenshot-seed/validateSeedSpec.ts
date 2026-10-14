import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../src/document-types/projectors";
import type { SeedSpec } from "./seedTypes";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): boolean {
  return (
    record(value) &&
    Object.values(value).every((field) => typeof field === "string")
  );
}

function attachment(value: unknown): boolean {
  if (!record(value)) return false;
  const { file, mimeType, slot } = value;
  return (
    typeof file === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(file) &&
    typeof mimeType === "string" &&
    mimeType.length > 0 &&
    (slot === undefined || (typeof slot === "string" && slot.length > 0))
  );
}

function optionalArray(
  value: unknown,
  valid: (item: unknown) => boolean,
): boolean {
  return value === undefined || (Array.isArray(value) && value.every(valid));
}

function document(value: unknown): boolean {
  if (!record(value)) return false;
  const { kind, fields, attachments, rows } = value;
  return (
    APP_DOCUMENT_PROJECTOR_DEFINITIONS.some(
      (definition) => definition.kind === kind,
    ) &&
    kind !== "note" &&
    (fields === undefined || strings(fields)) &&
    Array.isArray(attachments) &&
    attachments.every(attachment) &&
    optionalArray(rows, strings) &&
    (rows === undefined || kind === "weight" || kind === "blood_pressure")
  );
}

export function validateSeedSpec(value: unknown): asserts value is SeedSpec {
  if (!record(value)) throw new Error("Invalid Continuity seed object");
  const {
    schemaVersion,
    password,
    identitySeedPhrase,
    contacts,
    notes,
    files,
  } = value;
  if (
    schemaVersion !== 2 ||
    typeof password !== "string" ||
    !password ||
    typeof identitySeedPhrase !== "string" ||
    !identitySeedPhrase
  )
    throw new Error(
      "Unsupported or invalid Continuity seed: expected schemaVersion 2 and credentials",
    );
  if (
    !optionalArray(contacts, (item) => {
      if (!record(item)) return false;
      const { fields, avatar } = item;
      return strings(fields) && (avatar === undefined || attachment(avatar));
    }) ||
    !optionalArray(notes, (item) => {
      if (!record(item)) return false;
      const { text } = item;
      return typeof text === "string";
    })
  )
    throw new Error("Invalid seed contacts or notes");
  if (!optionalArray(files, document))
    throw new Error("Invalid seed document, attachment, or tracker rows");
}

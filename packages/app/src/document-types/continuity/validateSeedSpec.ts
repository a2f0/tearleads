import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../projectors";
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

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function distinct(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

// Each group names existing contacts with a first and last name, once each, and
// no two groups share a name. Members are admitted under those names, so a
// nameless member must fail here, before the seed writes anything.
function validGroups(groups: unknown, contactIds: ReadonlySet<unknown>) {
  return (
    optionalArray(groups, (item) => {
      if (!record(item)) return false;
      const { name, members } = item;
      return (
        nonEmptyString(name) &&
        Array.isArray(members) &&
        distinct(members) &&
        members.every((member) => contactIds.has(member))
      );
    }) &&
    (!Array.isArray(groups) ||
      distinct(groups.map(({ name }: { name?: unknown }) => name)))
  );
}

export function validateSeedSpec(value: unknown): asserts value is SeedSpec {
  if (!record(value)) throw new Error("Invalid Continuity seed object");
  const { schemaVersion, identitySeedPhrase, contacts, notes, files, groups } =
    value;
  if (schemaVersion !== 3 || !nonEmptyString(identitySeedPhrase))
    throw new Error(
      "Unsupported or invalid Continuity seed: expected schemaVersion 3 and an identity seed phrase",
    );
  if (
    !optionalArray(contacts, (item) => {
      if (!record(item)) return false;
      const { id, fields, avatar } = item;
      return (
        nonEmptyString(id) &&
        strings(fields) &&
        (avatar === undefined || attachment(avatar))
      );
    }) ||
    !optionalArray(notes, (item) => {
      if (!record(item)) return false;
      const { text } = item;
      return typeof text === "string" && text.length > 0;
    })
  )
    throw new Error("Invalid seed contacts or notes");
  if (!optionalArray(files, document))
    throw new Error("Invalid seed document, attachment, or tracker rows");
  const contactList: ReadonlyArray<{
    readonly fields: {
      readonly firstName?: unknown;
      readonly lastName?: unknown;
    };
    readonly id: unknown;
  }> = Array.isArray(contacts) ? contacts : [];
  const contactIds = contactList.map(({ id }) => id);
  const namedContactIds = new Set(
    contactList
      .filter(
        ({ fields }) =>
          nonEmptyString(fields.firstName) && nonEmptyString(fields.lastName),
      )
      .map(({ id }) => id),
  );
  if (!distinct(contactIds) || !validGroups(groups, namedContactIds))
    throw new Error("Invalid seed contact ids or groups");
}

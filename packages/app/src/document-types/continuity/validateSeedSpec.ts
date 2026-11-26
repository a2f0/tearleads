import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  APP_DOCUMENT_TYPE_PROJECTOR_DEFINITIONS,
} from "../projectors";
import {
  distinct,
  nonEmptyString,
  optionalArray,
  record,
  strings,
} from "./seedSpecValues";
import type { SeedSpec } from "./seedTypes";
import { validSeedFolders } from "./validateSeedFolders";

// Rows are tracker readings or a passcode's extra attributes.
const ROW_KINDS = new Set(["weight", "blood_pressure", "passcode"]);

function attachment(value: unknown): boolean {
  if (!record(value)) return false;
  const { file, mimeType, slot, avatar } = value;
  return (
    typeof file === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(file) &&
    typeof mimeType === "string" &&
    mimeType.length > 0 &&
    (slot === undefined || (typeof slot === "string" && slot.length > 0)) &&
    (avatar === undefined || avatar === true)
  );
}

// At most one avatar, and only a photo in its kind's photo gallery slot.
function validAvatar(kind: unknown, attachments: readonly unknown[]): boolean {
  const avatars = attachments.flatMap((item) => {
    if (!record(item)) return [];
    const { avatar, slot, mimeType } = item;
    return avatar === true ? [{ slot, mimeType }] : [];
  });
  if (avatars.length === 0) return true;
  const photos = APP_DOCUMENT_TYPE_PROJECTOR_DEFINITIONS.find(
    (definition) => definition.kind === kind,
  )?.photos;
  const [avatar] = avatars;
  return (
    avatars.length === 1 &&
    photos !== undefined &&
    avatar?.slot === photos.slotId &&
    typeof avatar.mimeType === "string" &&
    avatar.mimeType.startsWith("image/")
  );
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
    validAvatar(kind, attachments) &&
    optionalArray(rows, strings) &&
    (rows === undefined || ROW_KINDS.has(String(kind)))
  );
}

// Every organization already has these built-in groups.
const BUILT_IN_GROUP_NAMES = new Set(["admins", "members"]);

// Each group names existing contacts with a first and last name, once each, and
// no two groups share a name or take a built-in group's. Members are admitted
// under those names, so a nameless member must fail here, before the seed
// writes anything.
function validGroups(groups: unknown, contactIds: ReadonlySet<unknown>) {
  return (
    optionalArray(groups, (item) => {
      if (!record(item)) return false;
      const { name, members } = item;
      return (
        nonEmptyString(name) &&
        !BUILT_IN_GROUP_NAMES.has(name.trim().toLowerCase()) &&
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
  const {
    schemaVersion,
    identitySeedPhrase,
    contacts,
    notes,
    files,
    groups,
    folders,
  } = value;
  if (schemaVersion !== 4 || !nonEmptyString(identitySeedPhrase))
    throw new Error(
      "Unsupported or invalid Continuity seed: expected schemaVersion 4 and an identity seed phrase",
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
  if (!validSeedFolders(folders, Array.isArray(groups) ? groups : []))
    throw new Error("Invalid seed folders, grants, or note additions");
}

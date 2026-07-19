import type { ContactAvatarRef } from "./contactAvatarSlot";
import {
  type ContactDocumentFields,
  readContactFieldsFromRecord,
} from "./contactDocumentDefinition";

export interface ContactEntry {
  // Present only when the contact's document store reports a bound avatar
  // attachment. Entries loaded from the SQLite projection omit it (attachments
  // live only in the document store); consumers render a silhouette either way.
  avatar?: ContactAvatarRef | undefined;
  canWrite?: boolean | undefined;
  encapsulationPublicKey: string | null;
  firstName: string;
  id: string;
  isSelf: boolean;
  lastName: string;
  // Nullable: a contact may simply have no nickname. Consumers must treat an
  // absent nickname the same as an empty one (e.g. `(entry.nickname ?? "")`).
  nickname: string | null;
  userId: string | null;
}

export interface ContactEntryPatch {
  encapsulationPublicKey?: string | null | undefined;
  firstName?: string | undefined;
  isSelf?: boolean | undefined;
  lastName?: string | undefined;
  nickname?: string | undefined;
  userId?: string | null | undefined;
}

export function getContactDisplayName(entry: ContactEntry): string {
  const nickname = (entry.nickname ?? "").trim();
  if (nickname.length > 0) {
    return nickname;
  }

  return `${entry.firstName} ${entry.lastName}`.trim();
}

function normalizeOptionalString(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function readSelfField(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

export function contactFieldsToEntry(
  id: string,
  fields: ContactDocumentFields,
  options: {
    avatar?: ContactAvatarRef | null | undefined;
    canWrite?: boolean | undefined;
  } = {},
): ContactEntry {
  const userId = normalizeOptionalString(fields.userId);
  const encapsulationPublicKey = normalizeOptionalString(
    fields.encapsulationPublicKey,
  );

  return {
    ...(options.avatar ? { avatar: options.avatar } : {}),
    canWrite: options.canWrite ?? true,
    encapsulationPublicKey:
      encapsulationPublicKey.length > 0 ? encapsulationPublicKey : null,
    firstName: fields.firstName.trim(),
    id,
    isSelf: readSelfField(fields.isSelf),
    lastName: fields.lastName.trim(),
    nickname: fields.nickname.trim(),
    userId: userId.length > 0 ? userId : null,
  };
}

export function contactEntryToStructuredFieldPatch(
  patch: ContactEntryPatch,
): Record<string, string | undefined> {
  return {
    ...(patch.encapsulationPublicKey === undefined
      ? {}
      : {
          encapsulationPublicKey:
            normalizeOptionalString(patch.encapsulationPublicKey) || undefined,
        }),
    ...(patch.firstName === undefined
      ? {}
      : { firstName: patch.firstName.trim() }),
    ...(patch.isSelf === undefined ? {} : { isSelf: patch.isSelf ? "1" : "0" }),
    ...(patch.lastName === undefined
      ? {}
      : { lastName: patch.lastName.trim() }),
    ...(patch.nickname === undefined
      ? {}
      : { nickname: patch.nickname.trim() }),
    ...(patch.userId === undefined
      ? {}
      : { userId: normalizeOptionalString(patch.userId) || undefined }),
  };
}

export function readContactFields(
  fields: Readonly<Record<string, unknown>>,
): ContactDocumentFields {
  return readContactFieldsFromRecord(fields).fields;
}

import type { createDocument } from "@tearleads/loro";
import type { ContactEntry } from "./addressBookEntry";

export type ContactDocument = Awaited<ReturnType<typeof createDocument>>;

interface ContactDocumentMap {
  get: (key: string) => unknown;
  set: (key: string, value: string | number) => void;
  delete: (key: string) => void;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function setOptionalString(
  map: ContactDocumentMap,
  key: string,
  value: string | null,
) {
  if (value === null || value.length === 0) {
    map.delete(key);
    return;
  }

  map.set(key, value);
}

export function getContactEntryValue(
  contactId: string,
  doc: ContactDocument,
  isSelf = false,
): ContactEntry {
  const map = doc.getMap("contact");

  return {
    id: readString(map.get("id")) || contactId,
    firstName: readString(map.get("firstName")),
    lastName: readString(map.get("lastName")),
    userId: readOptionalString(map.get("userId")),
    encapsulationPublicKey: readOptionalString(
      map.get("encapsulationPublicKey"),
    ),
    isSelf,
  };
}

export function setContactEntryValue(
  doc: ContactDocument,
  entry: ContactEntry,
) {
  const map = doc.getMap("contact");
  map.set("id", entry.id);
  map.set("firstName", entry.firstName);
  map.set("lastName", entry.lastName);
  setOptionalString(map, "userId", entry.userId);
  setOptionalString(
    map,
    "encapsulationPublicKey",
    entry.encapsulationPublicKey,
  );
}

import type { createDocument } from "@tearleads/loro";
import type { AddressBookEntry } from "./addressBookEntry";

export type ContactDocument = Awaited<ReturnType<typeof createDocument>>;

export function getContactEntryValue(
  userId: string,
  doc: ContactDocument,
  isSelf = false,
): AddressBookEntry | null {
  const encapsulationPublicKey = doc
    .getMap("contact")
    .get("encapsulationPublicKey");

  return typeof encapsulationPublicKey === "string"
    ? {
        userId,
        encapsulationPublicKey,
        isSelf,
      }
    : null;
}

export function setContactEntryValue(
  doc: ContactDocument,
  entry: AddressBookEntry,
) {
  const map = doc.getMap("contact");
  map.set("userId", entry.userId);
  map.set("encapsulationPublicKey", entry.encapsulationPublicKey);
}

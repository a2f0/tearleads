import type { ContactsContextValue } from "../../stores/contacts/types";

export type ContactEntries = ContactsContextValue["entries"];
export type ContactEntryPatch = Parameters<
  ContactsContextValue["updateContact"]
>[1];

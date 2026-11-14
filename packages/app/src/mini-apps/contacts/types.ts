import type { ContactsContextValue } from "../../stores/contacts/types";

export type ContactEntries = ContactsContextValue["entries"];
export type ContactAddressActions = Pick<
  ContactsContextValue,
  "addContactAddress" | "updateContactAddress" | "removeContactAddress"
>;
export type ContactEntryPatch = Parameters<
  ContactsContextValue["updateContact"]
>[1];

import type {
  ContactEntry,
  ContactEntryPatch,
} from "@tearleads/client-sdk/workflows/contacts";

export interface ContactsContextValue {
  createContact: (patch: ContactEntryPatch) => Promise<string | null>;
  entries: ReadonlyArray<ContactEntry>;
  importKey: (userId: string) => Promise<string | null>;
  ready: boolean;
  removeContact: (contactId: string) => Promise<void>;
  updateContact: (contactId: string, patch: ContactEntryPatch) => Promise<void>;
}

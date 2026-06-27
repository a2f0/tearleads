import type {
  ContactEntry,
  ContactEntryPatch,
} from "../../document-types/contact/contactDocumentModel";

export interface ContactsContextValue {
  canWrite: boolean;
  createContact: (patch: ContactEntryPatch) => Promise<string | null>;
  entries: ReadonlyArray<ContactEntry>;
  importKey: (userId: string) => Promise<string | null>;
  ready: boolean;
  removeContact: (contactId: string) => Promise<void>;
  updateContact: (contactId: string, patch: ContactEntryPatch) => Promise<void>;
}

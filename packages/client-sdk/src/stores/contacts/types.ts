import type {
  ContactEntry,
  ContactEntryPatch,
  ContactsWorkflowRuntime,
} from "../../workflows/contacts";

export interface ContactsSnapshot {
  entries: ReadonlyArray<ContactEntry>;
  ready: boolean;
}

export type ContactsRuntime = ContactsWorkflowRuntime;

export interface ContactsStore {
  createContact: (patch: ContactEntryPatch) => Promise<string | null>;
  getSnapshot: () => ContactsSnapshot;
  importKey: (userId: string) => Promise<string | null>;
  removeContact: (contactId: string) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  updateContact: (contactId: string, patch: ContactEntryPatch) => Promise<void>;
  updateRuntime: (runtime: ContactsRuntime) => void;
}

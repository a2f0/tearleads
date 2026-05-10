import type {
  AddressBookEntry,
  ContactsWorkflowRuntime,
} from "../../workflows/contacts";

export interface ContactsContextValue {
  entries: ReadonlyArray<AddressBookEntry>;
  importKey: (userId: string) => Promise<void>;
  ready: boolean;
  removeKey: (userId: string) => Promise<void>;
}

export interface ContactsSnapshot {
  entries: ReadonlyArray<AddressBookEntry>;
  ready: boolean;
}

export type ContactsRuntime = ContactsWorkflowRuntime;

export interface ContactsStore {
  getSnapshot: () => ContactsSnapshot;
  importKey: (userId: string) => Promise<void>;
  removeKey: (userId: string) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: ContactsRuntime) => void;
}

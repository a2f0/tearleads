import type {
  DocumentStore,
  DocumentsRuntime,
  OpenDocumentInput,
  UserKey,
} from "@tearleads/client-sdk";
import type {
  ContactEntry,
  ContactEntryPatch,
} from "../../document-types/contact/contactDocumentModel";
import type { EnsureSelfContactInput } from "./selfContact";

export interface ContactsSnapshot {
  entries: ReadonlyArray<ContactEntry>;
  ready: boolean;
}

export interface ContactsRuntime {
  deleteDocument: (localId: string) => Promise<boolean>;
  documents: DocumentsRuntime;
  openDocumentStore: (
    input: OpenDocumentInput & { readonly localId: string },
  ) => DocumentStore;
}

export interface ContactsStore {
  createContact: (patch: ContactEntryPatch) => Promise<string | null>;
  ensureSelfContact: (
    input: string | EnsureSelfContactInput,
  ) => Promise<string | null>;
  getSnapshot: () => ContactsSnapshot;
  importKey: (userId: string) => Promise<string | null>;
  removeContact: (contactId: string) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  updateContact: (contactId: string, patch: ContactEntryPatch) => Promise<void>;
  updateRuntime: (runtime: ContactsRuntime) => void;
}

export interface ContactsStoreDependencies {
  fetchUserKey: (userId: string) => Promise<UserKey | null>;
  getLocalUserKey?: ((userId: string) => Promise<UserKey | null>) | undefined;
  logError: (message: string | Error, cause?: unknown) => void;
}

export interface TrackedContactDocumentStore {
  store: DocumentStore;
  unsubscribe: () => void;
}

export interface ContactsStoreState {
  contactDocumentStoresById: Map<string, TrackedContactDocumentStore>;
  dependencies: ContactsStoreDependencies;
  entriesById: Map<string, ContactEntry>;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  listeners: Set<() => void>;
  pendingSnapshotFlush: boolean;
  runtime: ContactsRuntime;
  snapshot: ContactsSnapshot;
  writeChain: Promise<void>;
}

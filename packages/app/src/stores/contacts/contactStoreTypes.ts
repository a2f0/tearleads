import type {
  DocumentStore,
  DocumentSummary,
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
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  moveDocumentToTrash: (
    note: DocumentSummary,
    trashContainerId: string,
  ) => Promise<DocumentSummary | null>;
  openDocumentStore: (
    input: OpenDocumentInput & { readonly localId: string },
  ) => DocumentStore;
  purgeDocument?: ((document: DocumentSummary) => Promise<boolean>) | undefined;
  subscribeToPersistedDocuments?:
    | ((listener: (document: DocumentSummary) => void) => () => void)
    | undefined;
  trashContainerId: string | null;
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
  initializationGeneration: number;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  listeners: Set<() => void>;
  onContactEntry: (entry: ContactEntry) => void;
  pendingSnapshotFlush: boolean;
  persistedDocumentsUnsubscribe: (() => void) | null;
  runtime: ContactsRuntime;
  snapshot: ContactsSnapshot;
  writeChain: Promise<void>;
}

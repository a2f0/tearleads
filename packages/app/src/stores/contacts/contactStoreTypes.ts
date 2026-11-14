import type {
  DocumentAttachmentUpload,
  DocumentStore,
  DocumentSummary,
  DocumentsRuntime,
  DomainScope,
  OpenDocumentInput,
  PendingWriteQueueItem,
  ResolvedUserIdentity,
} from "@tearleads/client-sdk";
import type { ContactAddressFields } from "../../document-types/contact/contactAddressModel";
import type {
  ContactEntry,
  ContactEntryPatch,
} from "../../document-types/contact/contactDocumentModel";
import type { DeleteToTrashTarget } from "../systemContainerTrash";
import type { SelfContactIdentityAuthority } from "./currentSelfContactIdentityState";
import type { EnsureSelfContactInput } from "./selfContact";

export interface ContactsSnapshot {
  entries: ReadonlyArray<ContactEntry>;
  ready: boolean;
}

export interface ContactsRuntime {
  documents: DocumentsRuntime;
  listPendingWrites: () => Promise<ReadonlyArray<PendingWriteQueueItem>>;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  moveDocumentToTrash: (
    note: DocumentSummary,
    trashContainerId: string,
  ) => Promise<DocumentSummary | null>;
  openDocumentStore: (
    input: OpenDocumentInput & { readonly localId: string },
  ) => DocumentStore;
  // Resolve the Trash a specific contact document should move into, org-awarely
  // and lazily provisioning the viewer's own Trash. A non-target outcome leaves
  // the contact in place and says why. Absent on bootstrap-only runtimes that
  // never remove contacts.
  resolveTrashContainerForDocument?:
    | ((document: DocumentSummary) => Promise<DeleteToTrashTarget>)
    | undefined;
  subscribeToPersistedDocuments?:
    | ((listener: (document: DocumentSummary) => void) => () => void)
    | undefined;
}

/** Caller-owned removal ports must not be replaced by a read-only subscriber. */
export interface ContactRemovalOperation {
  // A bound consumer supplies its own ports when the UI passes admission only.
  readonly runtime?: ContactsRuntime | undefined;
  readonly isCurrent: () => boolean;
  readonly runWhenCurrent?:
    | SelfContactIdentityAuthority["runWhenCurrent"]
    | undefined;
}

export interface ContactsStore {
  updateContactAddress: (
    contactId: string,
    addressId: string,
    patch: Partial<ContactAddressFields>,
    isCurrent?: () => boolean,
  ) => Promise<void>;
  removeContactAddress: (
    contactId: string,
    addressId: string,
    isCurrent?: () => boolean,
  ) => Promise<void>;
  /** Reuse an opaque draft identity on retries; omission starts a new intent. */
  addContactAddress: (
    contactId: string,
    fields: ContactAddressFields,
    intent?: object,
    isCurrent?: () => boolean,
  ) => Promise<string | null>;
  createContact: (patch: ContactEntryPatch) => Promise<string | null>;
  ensureSelfContact: (input: EnsureSelfContactInput) => Promise<string | null>;
  getSnapshot: () => ContactsSnapshot;
  /**
   * Adds a contact for a user whose identity a verified identity link (or
   * this device's own keys) established; `null` for any other user.
   */
  importVerifiedUser: (userId: string) => Promise<string | null>;
  removeContact: (
    contactId: string,
    operation?: ContactRemovalOperation,
  ) => Promise<void>;
  removeContactAvatar: (contactId: string) => Promise<void>;
  setContactAvatar: (
    contactId: string,
    upload: DocumentAttachmentUpload,
  ) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  updateContact: (contactId: string, patch: ContactEntryPatch) => Promise<void>;
  updateRuntime: (runtime: ContactsRuntime) => void;
}

export interface ContactsStoreDependencies {
  /**
   * `userIdentities.resolveVerified`, never trusting an observed pin, read in
   * the trust store of `scope`: the store's own database and identity. It
   * answers null when that scope is not active for the whole lookup.
   */
  resolveVerified: (
    userId: string,
    scope: DomainScope,
  ) => Promise<ResolvedUserIdentity | null>;
  getLocalUserIdentity?:
    | ((userId: string) => Promise<ResolvedUserIdentity | null>)
    | undefined;
  logError: (message: string | Error, cause?: unknown) => void;
}

export interface TrackedContactDocumentStore {
  store: DocumentStore;
  unsubscribe: () => void;
}

export interface ContactsStoreState {
  authorityGeneration: number;
  contactDocumentStoresById: Map<string, TrackedContactDocumentStore>;
  dependencies: ContactsStoreDependencies;
  entriesById: Map<string, ContactEntry>;
  initializationGeneration: number;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  listeners: Set<() => void>;
  pendingSnapshotFlush: boolean;
  persistedDocumentsUnsubscribe: (() => void) | null;
  runtime: ContactsRuntime;
  snapshot: ContactsSnapshot;
  writeChain: Promise<void>;
}

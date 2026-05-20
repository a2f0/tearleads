export type {
  ContactEntry,
  ContactEntryPatch,
} from "../../data/contacts/addressBookEntry";
export { getContactDisplayName } from "../../data/contacts/addressBookEntry";
export type {
  ContactPendingUpdateInsert,
  ContactsPersistence,
} from "../../data/persistence/contacts/contactsPersistence";
export { sqlContactsPersistence as defaultContactsPersistence } from "../../data/persistence/contacts/contactsPersistence";
export type {
  DocumentRecord as ContactDocumentRecord,
  PendingUpdateRecord as ContactPendingUpdateRecord,
} from "../../data/sqlite/documentPersistence";
export { DEFAULT_CONTACTS_ADDRESS_BOOK_ID } from "./constants";
export type { ContactProjectionUserKeyResolver } from "./projectionKeys";
export {
  type ContactsWorkflowRuntime,
  createContactsWorkflowRuntime,
} from "./runtime";
export {
  type ContactDocumentState,
  hasContactDocumentUpdateEvent,
} from "./sync";
export {
  type ContactSyncLane,
  isDestroyedContactSyncRuntimeError,
  registerContactSyncLane,
} from "./syncLane";

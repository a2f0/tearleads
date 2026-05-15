export type {
  ContactEntry,
  ContactEntryPatch,
} from "../../data/contacts/addressBookEntry";
export {
  getContactDisplayName,
  isTearleadsContact,
} from "../../data/contacts/addressBookEntry";
export { DEFAULT_CONTACTS_ADDRESS_BOOK_ID } from "./constants";
export {
  type ContactsPersistence,
  defaultContactsPersistence,
} from "./persistence";
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

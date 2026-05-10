export type { AddressBookEntry } from "../../data/contacts/addressBookEntry";
export { DEFAULT_CONTACTS_ADDRESS_BOOK_ID } from "./constants";
export {
  fetchContactKeyEntryFromRuntime,
  persistContactKeyEntryFromRuntime,
  removeContactKeyFromRuntime,
} from "./keys";
export {
  type ContactLocalStateRuntime,
  loadContactDocumentStates,
} from "./localState";
export {
  type ContactsPersistence,
  defaultContactsPersistence,
} from "./persistence";
export {
  type ContactProjectionUserKeyResolver,
  createContactProjectionUserKeyResolver,
  didContactProjectionKeyRuntimeChange,
} from "./projectionKeys";
export {
  type ContactDocumentState,
  hasContactDocumentUpdateEvent,
  syncContactDocuments,
} from "./sync";
export {
  type ContactSyncLane,
  didRegainContactSyncPrerequisites,
  isDestroyedContactSyncRuntimeError,
  registerContactSyncLane,
} from "./syncLane";

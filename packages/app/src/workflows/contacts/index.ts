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
  type ContactDocumentState,
  syncContactDocument,
} from "./sync";

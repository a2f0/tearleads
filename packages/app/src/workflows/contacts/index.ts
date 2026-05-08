export { DEFAULT_CONTACTS_ADDRESS_BOOK_ID } from "./constants";
export {
  deleteContactEntryFromRuntime,
  loadContactDocumentStates,
  persistImportedContactEntryFromRuntime,
} from "./localState";
export {
  type ContactsPersistence,
  defaultContactsPersistence,
} from "./persistence";
export {
  type ContactDocumentState,
  syncContactDocument,
} from "./sync";

import type { ContactEntry } from "../../document-types/contact/contactDocumentModel";
import type { ContactsStore } from "./contactStoreTypes";

export interface ContactsContextValue
  extends Pick<
    ContactsStore,
    | "createContact"
    | "importKey"
    | "removeContact"
    | "removeContactAvatar"
    | "setContactAvatar"
    | "updateContact"
  > {
  canWrite: boolean;
  entries: ReadonlyArray<ContactEntry>;
  ready: boolean;
}

import type { EncapsulationKeyResponse } from "@tearleads/validators/response";
import type { AddressBookEntry } from "../../data/contacts/addressBookEntry";
import {
  type ContactLocalStateRuntime,
  deleteContactEntryFromRuntime,
  persistImportedContactEntryFromRuntime,
} from "./localState";
import type { ContactsPersistence } from "./persistence";
import type { ContactDocumentState } from "./sync";

interface ContactKeyApi {
  getEncapsulationKey(userId: string): Promise<EncapsulationKeyResponse | null>;
}

interface ContactKeyLookupRuntime {
  apiClient: ContactKeyApi;
  log: (message: string) => void;
}

interface ContactKeyPersistenceRuntime extends ContactLocalStateRuntime {
  log: (message: string) => void;
}

export async function fetchContactKeyEntryFromRuntime(input: {
  runtime: ContactKeyLookupRuntime;
  userId: string;
}): Promise<AddressBookEntry | null> {
  const { runtime, userId } = input;
  runtime.log(`Importing peer key for userId: ${userId}`);

  const response = await runtime.apiClient.getEncapsulationKey(userId);
  if (!response) {
    return null;
  }

  return {
    userId: response.userId,
    encapsulationPublicKey: response.encapsulationPublicKey,
    isSelf: false,
  };
}

export async function persistContactKeyEntryFromRuntime(input: {
  addressBookId?: string | null;
  entry: AddressBookEntry;
  existingContact?: ContactDocumentState | null | undefined;
  persistence: ContactsPersistence;
  runtime: ContactKeyPersistenceRuntime;
}): Promise<{ changed: boolean; contact: ContactDocumentState }> {
  const imported = await persistImportedContactEntryFromRuntime({
    ...(input.addressBookId === undefined
      ? {}
      : { addressBookId: input.addressBookId }),
    entry: input.entry,
    existingContact: input.existingContact,
    persistence: input.persistence,
    runtime: input.runtime,
  });
  if (imported.changed) {
    input.runtime.log("Peer key imported");
  }

  return imported;
}

export async function removeContactKeyFromRuntime(input: {
  addressBookId?: string | null;
  persistence: ContactsPersistence;
  runtime: ContactKeyPersistenceRuntime;
  userId: string;
}): Promise<void> {
  await deleteContactEntryFromRuntime(input);
  input.runtime.log("Peer key removed");
}

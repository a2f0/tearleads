import type { AddressBookEntry } from "../../data/contacts/addressBookEntry";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { AppDataContextValue } from "../../providers/data/AppDataProvider";

type ContactsAppData = AppDataContextValue;

export interface ContactsContextValue {
  entries: ReadonlyArray<AddressBookEntry>;
  importKey: (userId: string) => Promise<void>;
  ready: boolean;
  removeKey: (userId: string) => Promise<void>;
}

export interface ContactsSnapshot {
  entries: ReadonlyArray<AddressBookEntry>;
  ready: boolean;
}

export interface ContactsRuntime {
  apiClient: ContactsAppData["apiClient"];
  containerId: ContactsAppData["containerId"];
  dbStatus: ContactsAppData["dbStatus"];
  domainScope: ContactsAppData["domainScope"];
  encapsulationKeyPair: ContactsAppData["encapsulationKeyPair"];
  events: ContactsAppData["events"];
  execSql: ExecSql;
  isAuthenticated: ContactsAppData["isAuthenticated"];
  log: ContactsAppData["log"];
  logError: ContactsAppData["logError"];
  online: ContactsAppData["online"];
  organizationId?: ContactsAppData["organizationId"];
  signingFingerprint?: ContactsAppData["signingFingerprint"];
  signingKeyPair?: ContactsAppData["signingKeyPair"];
  userId?: ContactsAppData["userId"];
}

export interface ContactsStore {
  getSnapshot: () => ContactsSnapshot;
  importKey: (userId: string) => Promise<void>;
  removeKey: (userId: string) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: ContactsRuntime) => void;
}

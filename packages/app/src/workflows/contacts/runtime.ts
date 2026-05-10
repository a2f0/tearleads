import type { AddressBookEntry } from "../../data/contacts/addressBookEntry";
import {
  fetchContactKeyEntryFromRuntime,
  persistContactKeyEntryFromRuntime,
  removeContactKeyFromRuntime,
} from "./keys";
import { loadContactDocumentStates } from "./localState";
import {
  type ContactProjectionUserKeyResolver,
  createContactProjectionUserKeyResolver,
  didContactProjectionKeyRuntimeChange,
} from "./projectionKeys";
import { type ContactDocumentState, syncContactDocuments } from "./sync";
import { didRegainContactSyncPrerequisites } from "./syncLane";

type ContactsWorkflowRuntimeInput = Parameters<
  typeof syncContactDocuments
>[0]["runtime"] & {
  dbStatus: string;
  domainScope: object;
  events: ReadonlyArray<unknown>;
  logError: (message: string | Error, cause?: unknown) => void;
};

type ContactDocumentStateLoadInput = Omit<
  Parameters<typeof loadContactDocumentStates>[0],
  "runtime"
>;
type ContactKeyPersistenceInput = Omit<
  Parameters<typeof persistContactKeyEntryFromRuntime>[0],
  "runtime"
>;
type ContactKeyRemovalInput = Omit<
  Parameters<typeof removeContactKeyFromRuntime>[0],
  "runtime"
>;
type ContactSyncInput = Omit<
  Parameters<typeof syncContactDocuments>[0],
  "runtime"
>;

export interface ContactsWorkflowRuntime {
  readonly dbStatus: string;
  readonly domainScope: object;
  readonly events: ReadonlyArray<unknown>;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  createProjectionUserKeyResolver: () => ContactProjectionUserKeyResolver;
  didProjectionKeyRuntimeChange: (
    previousRuntime: ContactsWorkflowRuntime,
  ) => boolean;
  didRegainSyncPrerequisites: (
    previousRuntime: ContactsWorkflowRuntime,
  ) => boolean;
  fetchKeyEntry: (userId: string) => Promise<AddressBookEntry | null>;
  loadDocumentStates: (
    input: ContactDocumentStateLoadInput,
  ) => Promise<ContactDocumentState[]>;
  persistKeyEntry: (
    input: ContactKeyPersistenceInput,
  ) => ReturnType<typeof persistContactKeyEntryFromRuntime>;
  removeKey: (
    input: ContactKeyRemovalInput,
  ) => ReturnType<typeof removeContactKeyFromRuntime>;
  syncDocuments: (
    input: ContactSyncInput,
  ) => ReturnType<typeof syncContactDocuments>;
}

const contactsWorkflowRuntimeInputs = new WeakMap<
  ContactsWorkflowRuntime,
  ContactsWorkflowRuntimeInput
>();

function contactSyncPrerequisites(input: ContactsWorkflowRuntimeInput) {
  return {
    encapsulationKeyPair: input.encapsulationKeyPair,
    isAuthenticated: input.isAuthenticated,
    online: input.online,
  };
}

function lookupContactsWorkflowRuntimeInput(
  runtime: ContactsWorkflowRuntime,
): ContactsWorkflowRuntimeInput | null {
  return contactsWorkflowRuntimeInputs.get(runtime) ?? null;
}

export function createContactsWorkflowRuntime(
  input: ContactsWorkflowRuntimeInput,
): ContactsWorkflowRuntime {
  const runtime: ContactsWorkflowRuntime = {
    dbStatus: input.dbStatus,
    domainScope: input.domainScope,
    events: input.events,
    logError: input.logError,
    createProjectionUserKeyResolver: () =>
      createContactProjectionUserKeyResolver(input),
    didProjectionKeyRuntimeChange: (previousRuntime) => {
      const previousInput = lookupContactsWorkflowRuntimeInput(previousRuntime);
      return previousInput
        ? didContactProjectionKeyRuntimeChange(previousInput, input)
        : true;
    },
    didRegainSyncPrerequisites: (previousRuntime) => {
      const previousInput = lookupContactsWorkflowRuntimeInput(previousRuntime);
      return previousInput
        ? didRegainContactSyncPrerequisites(
            contactSyncPrerequisites(previousInput),
            contactSyncPrerequisites(input),
          )
        : false;
    },
    fetchKeyEntry: (userId) =>
      fetchContactKeyEntryFromRuntime({
        runtime: input,
        userId,
      }),
    loadDocumentStates: (loadInput) =>
      loadContactDocumentStates({
        ...loadInput,
        runtime: input,
      }),
    persistKeyEntry: (persistInput) =>
      persistContactKeyEntryFromRuntime({
        ...persistInput,
        runtime: input,
      }),
    removeKey: (removeInput) =>
      removeContactKeyFromRuntime({
        ...removeInput,
        runtime: input,
      }),
    syncDocuments: (syncInput) =>
      syncContactDocuments({
        ...syncInput,
        runtime: input,
      }),
  };

  contactsWorkflowRuntimeInputs.set(runtime, input);

  return runtime;
}

import type { ContactEntry } from "../../data/contacts/addressBookEntry";
import type { DomainScope } from "../../data/domainScope";
import { fetchContactKeyEntryFromRuntime } from "./keys";
import {
  deleteContactEntryFromRuntime,
  loadContactDocumentStates,
  persistContactEntryFromRuntime,
} from "./localState";
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
  domainScope: DomainScope;
  events: ReadonlyArray<unknown>;
  logError: (message: string | Error, cause?: unknown) => void;
};

type ContactDocumentStateLoadInput = Omit<
  Parameters<typeof loadContactDocumentStates>[0],
  "runtime"
>;
type ContactPersistenceInput = Omit<
  Parameters<typeof persistContactEntryFromRuntime>[0],
  "runtime"
>;
type ContactRemovalInput = Omit<
  Parameters<typeof deleteContactEntryFromRuntime>[0],
  "runtime"
>;
type ContactSyncInput = Omit<
  Parameters<typeof syncContactDocuments>[0],
  "runtime"
>;

export interface ContactsWorkflowRuntime {
  readonly dbStatus: string;
  readonly domainScope: DomainScope;
  readonly events: ReadonlyArray<unknown>;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly userId: string | null;
  createProjectionUserKeyResolver: () => ContactProjectionUserKeyResolver;
  didProjectionKeyRuntimeChange: (
    previousRuntime: ContactsWorkflowRuntime,
  ) => boolean;
  didRegainSyncPrerequisites: (
    previousRuntime: ContactsWorkflowRuntime,
  ) => boolean;
  fetchKeyEntry: (userId: string) => Promise<ContactEntry | null>;
  loadDocumentStates: (
    input: ContactDocumentStateLoadInput,
  ) => Promise<ContactDocumentState[]>;
  persistContactEntry: (
    input: ContactPersistenceInput,
  ) => ReturnType<typeof persistContactEntryFromRuntime>;
  removeContactEntry: (
    input: ContactRemovalInput,
  ) => ReturnType<typeof deleteContactEntryFromRuntime>;
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
    userId: input.userId ?? null,
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
    persistContactEntry: (persistInput) =>
      persistContactEntryFromRuntime({
        ...persistInput,
        runtime: input,
      }),
    removeContactEntry: (removeInput) =>
      deleteContactEntryFromRuntime({
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

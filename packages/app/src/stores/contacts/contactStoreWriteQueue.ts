import {
  hasContactsContainerRuntime,
  waitForContactsInitialization,
} from "./contactStoreInitialization";
import { canWriteContactEntry } from "./contactStoreLookup";
import type { ContactsStoreState } from "./contactStoreTypes";

/**
 * Awaits store initialization and reports whether the runtime can take a
 * contact write: database ready, Contacts container present, and — when a
 * contact id is given — that contact writable.
 */
export async function contactsRuntimeWritable(
  state: ContactsStoreState,
  contactId?: string,
): Promise<boolean> {
  await waitForContactsInitialization(state);
  return (
    state.runtime.documents.infra.dbStatus === "ready" &&
    hasContactsContainerRuntime(state) &&
    (contactId === undefined || canWriteContactEntry(state, contactId))
  );
}

/** Bind admission and acknowledgment to this exact store/account lifetime. */
export function captureContactsScope(state: ContactsStoreState): () => boolean {
  const { containerId, domainScope } = state.runtime.documents.state;
  const { execSql } = state.runtime.documents.infra;
  const { userId, isAuthenticated, organizationId } =
    state.runtime.documents.auth;
  const { signingFingerprint } = state.runtime.documents.crypto;
  const generation = state.initializationGeneration;
  const authorityGeneration = state.authorityGeneration;
  return () =>
    state.initializationGeneration === generation &&
    state.authorityGeneration === authorityGeneration &&
    state.runtime.documents.state.containerId === containerId &&
    state.runtime.documents.state.domainScope === domainScope &&
    state.runtime.documents.infra.execSql === execSql &&
    state.runtime.documents.infra.dbStatus === "ready" &&
    state.runtime.documents.auth.userId === userId &&
    state.runtime.documents.auth.isAuthenticated === isAuthenticated &&
    state.runtime.documents.auth.organizationId === organizationId &&
    state.runtime.documents.crypto.signingFingerprint === signingFingerprint;
}

/**
 * Appends `work` to the store's serialized write chain, funneling its failure
 * into the store log; resolves once the queued write settles.
 */
export function queueContactWrite<T>(
  state: ContactsStoreState,
  errorMessage: string,
  work: () => Promise<T> | T,
): Promise<T | undefined> {
  const result = state.writeChain
    .catch(() => undefined)
    .then(work)
    .catch((error: unknown) => {
      state.dependencies.logError(errorMessage, error);
      return undefined;
    });
  state.writeChain = result.then(() => undefined);
  return result;
}

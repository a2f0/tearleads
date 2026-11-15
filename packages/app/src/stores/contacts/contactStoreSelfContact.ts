import {
  type DocumentStore,
  deriveStableDocumentId,
} from "@tearleads/client-sdk";
import { writeContactPatch } from "./contactStoreFieldWrites";
import { ensureContactDocumentStore } from "./contactStoreInitialization";
import {
  contactEntryFromDocumentStore,
  getUserIdentityForSelfContact,
} from "./contactStoreLookup";
import { loadSelfContactSelection } from "./contactStoreSelfSelection";
import type { ContactsStoreState } from "./contactStoreTypes";
import {
  captureContactsScope,
  contactsRuntimeWritable,
  queueContactWrite,
} from "./contactStoreWriteQueue";
import {
  type EnsureSelfContactInput,
  getSelfContactLocalId,
  isSelfContactCurrent,
  type ResolvedSelfContactIdentity,
} from "./selfContact";

async function resolveSelfContactIdentity(
  state: ContactsStoreState,
  input: EnsureSelfContactInput,
  current: () => boolean,
): Promise<ResolvedSelfContactIdentity | null> {
  const fingerprint = state.runtime.documents.crypto.signingFingerprint;
  if (!fingerprint?.trim() || !current()) return null;
  const localId = getSelfContactLocalId(fingerprint);
  const userId = input.userId ?? null;
  if (
    (input.localId != null && input.localId !== localId) ||
    (userId !== null && userId !== state.runtime.documents.auth.userId)
  ) {
    return null;
  }
  let encapsulationPublicKey = input.encapsulationPublicKey?.trim() || null;
  if (userId && !encapsulationPublicKey) {
    const identity = await getUserIdentityForSelfContact(
      state.dependencies,
      userId,
    );
    if (
      !current() ||
      identity?.userId !== userId ||
      identity.signingKeyFingerprint !== fingerprint
    ) {
      return null;
    }
    encapsulationPublicKey = identity.encapsulationPublicKey;
  }
  const documentId = await deriveStableDocumentId(localId);
  return current()
    ? { documentId, encapsulationPublicKey, localId, userId }
    : null;
}

function writeSelectedSelfContactIdentity(
  state: ContactsStoreState,
  contactId: string,
  store: DocumentStore,
  identity: ResolvedSelfContactIdentity,
  deferRemoteSync: boolean,
  targetCurrent: () => boolean,
): boolean | Promise<boolean> {
  const entry = contactEntryFromDocumentStore(contactId, store);
  // A signed-out ensure preserves a promoted canonical identity. It must
  // still flush a failed persist before acknowledging the live fields.
  const preservesRemoteIdentity =
    deferRemoteSync &&
    identity.userId === null &&
    identity.encapsulationPublicKey === null &&
    entry?.isSelf === true;
  const alreadyCurrent =
    preservesRemoteIdentity || isSelfContactCurrent(entry, identity);
  if (alreadyCurrent && deferRemoteSync) {
    return store.hasUnsavedLocalEdits()
      ? writeContactPatch(
          state,
          contactId,
          {},
          {
            deferRemoteSync,
            guard: targetCurrent,
          },
        )
      : targetCurrent();
  }
  return writeContactPatch(
    state,
    contactId,
    {
      encapsulationPublicKey: identity.encapsulationPublicKey,
      isSelf: true,
      userId: identity.userId,
    },
    { deferRemoteSync, guard: targetCurrent },
  );
}

export async function ensureSelfContactFromRuntime(
  state: ContactsStoreState,
  input: EnsureSelfContactInput,
  guard: () => boolean = () => true,
): Promise<string | null> {
  const scoped = captureContactsScope(state);
  const current = () => scoped() && guard();
  if (!current() || !(await contactsRuntimeWritable(state)) || !current()) {
    return null;
  }
  const identity = await resolveSelfContactIdentity(state, input, current);
  if (!identity || !current()) return null;
  const selection = await loadSelfContactSelection(state, identity, current);
  if (selection.status === "refused" || !current()) return null;
  const { contactId } = selection;
  const deferRemoteSync = input.deferRemoteSync === true;
  const saved = await queueContactWrite(
    state,
    "Contacts: failed to ensure self contact.",
    async () => {
      const queued = await loadSelfContactSelection(state, identity, current);
      if (
        !current() ||
        queued.status === "refused" ||
        queued.contactId !== contactId
      ) {
        return false;
      }
      const store = ensureContactDocumentStore(state, contactId, {
        deferRemoteSync,
      });
      const ready = await store.ensureInitialized();
      if (!ready || !current()) return false;
      const loaded = await loadSelfContactSelection(state, identity, current);
      if (
        !current() ||
        loaded.status !== "existing" ||
        loaded.contactId !== contactId
      ) {
        return false;
      }
      const targetCurrent = () => {
        const snapshot = store.getSnapshot();
        return (
          current() &&
          snapshot.ready &&
          snapshot.canWrite &&
          (snapshot.documentId === null ||
            snapshot.documentId === identity.documentId)
        );
      };
      if (!targetCurrent()) return false;
      return writeSelectedSelfContactIdentity(
        state,
        contactId,
        store,
        identity,
        deferRemoteSync,
        targetCurrent,
      );
    },
  );
  if (!saved || !current()) return null;
  const acknowledged = await loadSelfContactSelection(state, identity, current);
  return current() &&
    acknowledged.status === "existing" &&
    acknowledged.contactId === contactId
    ? contactId
    : null;
}

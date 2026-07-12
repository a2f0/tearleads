import type { ContactEntry } from "../../document-types/contact/contactDocumentModel";
import { loadContactDocumentSummary } from "./contactDocumentSummary";
import { ensureContactDocumentStore } from "./contactStoreInitialization";
import { contactEntryFromDocumentStore } from "./contactStoreLookup";
import { upsertContactEntry } from "./contactStoreSnapshotMutations";
import type { ContactsStoreState } from "./contactStoreTypes";
import {
  type EnsureSelfContactInput,
  getSelfContactLocalId,
} from "./selfContact";

interface LateSelfContactReconciliation {
  readonly canApply: () => boolean;
  readonly input: EnsureSelfContactInput;
}

export function createLateSelfContactReconciliation(
  state: ContactsStoreState,
  entry: ContactEntry,
): LateSelfContactReconciliation | null {
  const documentsRuntime = state.runtime.documents;
  const userId = documentsRuntime.auth.userId;
  const signingFingerprint =
    documentsRuntime.crypto.signingFingerprint?.trim() ?? "";
  if (
    !userId ||
    !signingFingerprint ||
    !entry.isSelf ||
    entry.userId !== userId ||
    entry.canWrite === false
  ) {
    return null;
  }

  const localId = getSelfContactLocalId(signingFingerprint);
  if (entry.id === localId) {
    return null;
  }

  const containerId = documentsRuntime.state.containerId;
  const domainScope = documentsRuntime.state.domainScope;
  const execSql = documentsRuntime.infra.execSql;
  const generation = state.initializationGeneration;
  return {
    canApply: () => {
      const currentRuntime = state.runtime.documents;
      return (
        state.initializationGeneration === generation &&
        currentRuntime.state.containerId === containerId &&
        currentRuntime.state.domainScope === domainScope &&
        currentRuntime.infra.execSql === execSql &&
        currentRuntime.auth.userId === userId &&
        currentRuntime.crypto.signingFingerprint?.trim() === signingFingerprint
      );
    },
    input: {
      deferRemoteSync: true,
      encapsulationPublicKey: entry.encapsulationPublicKey,
      localId,
      userId,
    },
  };
}

export async function hydrateLateSelfContactFallback(
  state: ContactsStoreState,
  reconciliation: LateSelfContactReconciliation,
): Promise<void> {
  const localId = reconciliation.input.localId;
  if (!localId || !reconciliation.canApply()) {
    return;
  }

  const summary = await loadContactDocumentSummary(state, localId);
  if (!summary || !reconciliation.canApply()) {
    return;
  }

  const store = ensureContactDocumentStore(state, localId, {
    deferRemoteSync: true,
  });
  await store.ensureInitialized();
  if (!reconciliation.canApply()) {
    return;
  }

  const entry = contactEntryFromDocumentStore(localId, store);
  if (entry) {
    upsertContactEntry(state, entry);
  }
}

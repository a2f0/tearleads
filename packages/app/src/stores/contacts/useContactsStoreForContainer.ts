import type { ResolvedUserIdentity, Tearleads } from "@tearleads/client-sdk";
import { toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { useEffect, useMemo } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { useRuntimeScopedMemo } from "../../providers/sdk/useRuntimeScopedMemo";
import {
  type ContactsRuntime,
  type ContactsStore,
  getOrCreateContactsStore,
} from "./contactStore";

async function getLocalUserIdentity(input: {
  encapsulationKeyPair: ReturnType<
    typeof useTearleads
  >["identity"]["encapsulationKeyPair"];
  signingFingerprint: ReturnType<
    typeof useTearleads
  >["identity"]["signingFingerprint"];
  signingKeyPair: ReturnType<typeof useTearleads>["identity"]["signingKeyPair"];
  userId: string;
}): Promise<ResolvedUserIdentity | null> {
  const { encapsulationKeyPair, signingFingerprint, signingKeyPair, userId } =
    input;
  if (!encapsulationKeyPair || !signingKeyPair) {
    return null;
  }

  const [computedSigningFingerprint, encapsulationKeyFingerprint] =
    await Promise.all([
      toFingerprint(signingKeyPair.signingPublicKey),
      toFingerprint(encapsulationKeyPair.publicKey),
    ]);
  if (signingFingerprint && signingFingerprint !== computedSigningFingerprint) {
    return null;
  }

  return {
    encapsulationKeyFingerprint,
    encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
    signingKeyFingerprint: computedSigningFingerprint,
    signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
    userId,
  };
}

export function useContactsStoreForContainer(
  contactsContainerId: string | null,
  resolveTrashContainerForDocument?: ContactsRuntime["resolveTrashContainerForDocument"],
): ContactsStore {
  const runtime = useContactsRuntime(
    contactsContainerId,
    resolveTrashContainerForDocument,
  );
  const store = useContactsStore(runtime);

  useEffect(() => {
    store.updateRuntime(runtime);
  }, [store, runtime]);

  return store;
}

function useContactsRuntime(
  contactsContainerId: string | null,
  resolveTrashContainerForDocument: ContactsRuntime["resolveTrashContainerForDocument"],
): ContactsRuntime {
  const tearleads = useTearleads();
  const documentsRuntime = useRuntimeScopedMemo(
    () => tearleads.documents.workflowRuntime(contactsContainerId),
    [contactsContainerId, tearleads],
  );
  const documentLinks = useRuntimeScopedMemo(
    () => tearleads.containerContents.documentLinks(),
    [tearleads],
  );
  const documentQueries = useRuntimeScopedMemo(
    () => tearleads.containerContents.documentQueries(),
    [tearleads],
  );
  return useMemo(
    () =>
      createContactsRuntimeForContainer(
        tearleads,
        documentsRuntime,
        resolveTrashContainerForDocument,
        (note, targetContainerId) =>
          documentLinks
            .moveDocumentToContainer({
              expandNode: () => undefined,
              mergeDocumentSummary: () => undefined,
              note,
              replaceLinkedContainers: true,
              setLinkedContainerIdsForDocument: () => undefined,
              sourceContainerId: note.containerId,
              targetContainerId,
            })
            .then((result) => result.note),
        (localId) => documentQueries.loadDocumentSummary(localId),
      ),
    [
      documentLinks,
      documentQueries,
      documentsRuntime,
      resolveTrashContainerForDocument,
      tearleads,
    ],
  );
}

function useContactsStore(runtime: ContactsRuntime): ContactsStore {
  const tearleads = useTearleads();
  return useMemo(
    () => createContactsStore(runtime, tearleads),
    [runtime, tearleads],
  );
}

function createContactsStore(
  runtime: ContactsRuntime,
  tearleads: Tearleads,
): ContactsStore {
  return getOrCreateContactsStore(
    runtime.documents.state.domainScope,
    runtime,
    {
      resolveUserIdentity: (userId) => tearleads.userIdentities.resolve(userId),
      getLocalUserIdentity: (userId) =>
        getLocalUserIdentity({
          encapsulationKeyPair: tearleads.identity.encapsulationKeyPair,
          signingFingerprint: tearleads.identity.signingFingerprint,
          signingKeyPair: tearleads.identity.signingKeyPair,
          userId,
        }),
      logError: tearleads.logError,
    },
  );
}

export function createContactsRuntimeForContainer(
  tearleads: Tearleads,
  documentsRuntime: ContactsRuntime["documents"],
  resolveTrashContainerForDocument: ContactsRuntime["resolveTrashContainerForDocument"] = undefined,
  moveDocumentToTrash: ContactsRuntime["moveDocumentToTrash"] = () =>
    Promise.resolve(null),
  loadDocumentSummary: ContactsRuntime["loadDocumentSummary"] = (localId) =>
    tearleads.containerContents.documentQueries().loadDocumentSummary(localId),
): ContactsRuntime {
  const documentLinks = tearleads.containerContents.documentLinks();
  return {
    deleteDocument: (localId) => tearleads.documents.delete(localId),
    documents: documentsRuntime,
    loadDocumentSummary,
    moveDocumentToTrash,
    openDocumentStore: (input) =>
      tearleads.documents.open(input, {
        workflowRuntime: documentsRuntime,
      }),
    purgeDocument: async (document) =>
      (await documentLinks.purgeDocument({ note: document })) !== null,
    resolveTrashContainerForDocument,
    subscribeToPersistedDocuments: (listener) =>
      tearleads.documents.subscribe(listener, {
        containerId: documentsRuntime.state.containerId,
      }),
  };
}

export function getOrCreateContactsStoreForRuntime(
  tearleads: Tearleads,
  runtime: ContactsRuntime,
): ContactsStore {
  return createContactsStore(runtime, tearleads);
}

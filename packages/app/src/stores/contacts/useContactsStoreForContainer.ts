import type { ResolvedUserIdentity, SymCrypt } from "@symcrypt/client-sdk";
import { toFingerprint } from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import { useEffect, useMemo } from "react";
import { useSymCrypt } from "../../providers/sdk/SymCryptProvider";
import { useRuntimeScopedMemo } from "../../providers/sdk/useRuntimeScopedMemo";
import {
  type ContactsRuntime,
  type ContactsStore,
  getOrCreateContactsStore,
} from "./contactStore";

async function getLocalUserIdentity(input: {
  encapsulationKeyPair: ReturnType<
    typeof useSymCrypt
  >["identity"]["encapsulationKeyPair"];
  signingFingerprint: ReturnType<
    typeof useSymCrypt
  >["identity"]["signingFingerprint"];
  signingKeyPair: ReturnType<typeof useSymCrypt>["identity"]["signingKeyPair"];
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
  const symcrypt = useSymCrypt();
  const documentsRuntime = useRuntimeScopedMemo(
    () => symcrypt.documents.workflowRuntime(contactsContainerId),
    [contactsContainerId, symcrypt],
  );
  const documentLinks = useRuntimeScopedMemo(
    () => symcrypt.containerContents.documentLinks(),
    [symcrypt],
  );
  const documentQueries = useRuntimeScopedMemo(
    () => symcrypt.containerContents.documentQueries(),
    [symcrypt],
  );
  return useMemo(
    () =>
      createContactsRuntimeForContainer(
        symcrypt,
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
      symcrypt,
    ],
  );
}

function useContactsStore(runtime: ContactsRuntime): ContactsStore {
  const symcrypt = useSymCrypt();
  return useMemo(
    () => createContactsStore(runtime, symcrypt),
    [runtime, symcrypt],
  );
}

function createContactsStore(
  runtime: ContactsRuntime,
  symcrypt: SymCrypt,
): ContactsStore {
  return getOrCreateContactsStore(
    runtime.documents.state.domainScope,
    runtime,
    {
      resolveUserIdentity: (userId) => symcrypt.userIdentities.resolve(userId),
      getLocalUserIdentity: (userId) =>
        getLocalUserIdentity({
          encapsulationKeyPair: symcrypt.identity.encapsulationKeyPair,
          signingFingerprint: symcrypt.identity.signingFingerprint,
          signingKeyPair: symcrypt.identity.signingKeyPair,
          userId,
        }),
      logError: symcrypt.logError,
    },
  );
}

export function createContactsRuntimeForContainer(
  symcrypt: SymCrypt,
  documentsRuntime: ContactsRuntime["documents"],
  resolveTrashContainerForDocument: ContactsRuntime["resolveTrashContainerForDocument"] = undefined,
  moveDocumentToTrash: ContactsRuntime["moveDocumentToTrash"] = () =>
    Promise.resolve(null),
  loadDocumentSummary: ContactsRuntime["loadDocumentSummary"] = (localId) =>
    symcrypt.containerContents.documentQueries().loadDocumentSummary(localId),
): ContactsRuntime {
  const documentLinks = symcrypt.containerContents.documentLinks();
  return {
    deleteDocument: (localId) => symcrypt.documents.delete(localId),
    documents: documentsRuntime,
    loadDocumentSummary,
    moveDocumentToTrash,
    openDocumentStore: (input) =>
      symcrypt.documents.open(input, {
        workflowRuntime: documentsRuntime,
      }),
    purgeDocument: async (document) =>
      (await documentLinks.purgeDocument({ note: document })) !== null,
    resolveTrashContainerForDocument,
    subscribeToPersistedDocuments: (listener) =>
      symcrypt.documents.subscribe(listener, {
        containerId: documentsRuntime.state.containerId,
      }),
  };
}

export function getOrCreateContactsStoreForRuntime(
  symcrypt: SymCrypt,
  runtime: ContactsRuntime,
): ContactsStore {
  return createContactsStore(runtime, symcrypt);
}

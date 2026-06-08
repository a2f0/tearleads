import type { UserKey } from "@tearleads/client-sdk";
import { toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { useEffect, useMemo } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import {
  type ContactsRuntime,
  type ContactsStore,
  getOrCreateContactsStore,
} from "./contactStore";

async function getLocalUserKey(input: {
  encapsulationKeyPair: ReturnType<
    typeof useTearleads
  >["identity"]["encapsulationKeyPair"];
  signingFingerprint: ReturnType<
    typeof useTearleads
  >["identity"]["signingFingerprint"];
  signingKeyPair: ReturnType<typeof useTearleads>["identity"]["signingKeyPair"];
  userId: string;
}): Promise<UserKey | null> {
  const { encapsulationKeyPair, signingFingerprint, signingKeyPair, userId } =
    input;
  if (!encapsulationKeyPair || !signingKeyPair) {
    return null;
  }

  const computedSigningFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  if (signingFingerprint && signingFingerprint !== computedSigningFingerprint) {
    return null;
  }

  return {
    encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
    signingKeyFingerprint: computedSigningFingerprint,
    signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
    userId,
  };
}

export function useContactsStoreForContainer(
  contactsContainerId: string | null,
): ContactsStore {
  const tearleads = useTearleads();
  const appData = useTearleadsRuntime();
  const runtime = useContactsRuntime(contactsContainerId);
  const store = useContactsStore(runtime);

  useEffect(() => {
    store.updateRuntime(runtime);
  }, [store, runtime]);

  useEnsureSelfContact(store, contactsContainerId, appData, tearleads);

  return store;
}

function useContactsRuntime(
  contactsContainerId: string | null,
): ContactsRuntime {
  const tearleads = useTearleads();
  const appData = useTearleadsRuntime();
  const documentsRuntime = useMemo(
    () => tearleads.documents.workflowRuntime(contactsContainerId),
    [appData, contactsContainerId, tearleads],
  );
  return useMemo<ContactsRuntime>(
    () => ({
      deleteLocalDocument: (localId) =>
        tearleads.documents.deleteLocal(localId),
      documents: documentsRuntime,
      openDocumentStore: (input) =>
        tearleads.documents.open(input, {
          workflowRuntime: documentsRuntime,
        }),
    }),
    [documentsRuntime, tearleads],
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
  tearleads: ReturnType<typeof useTearleads>,
): ContactsStore {
  return getOrCreateContactsStore(
    runtime.documents.state.domainScope,
    runtime,
    {
      fetchUserKey: (userId) => tearleads.userKeys.fetch(userId),
      getLocalUserKey: (userId) =>
        getLocalUserKey({
          encapsulationKeyPair: tearleads.identity.encapsulationKeyPair,
          signingFingerprint: tearleads.identity.signingFingerprint,
          signingKeyPair: tearleads.identity.signingKeyPair,
          userId,
        }),
      logError: tearleads.logError,
    },
  );
}

function useEnsureSelfContact(
  store: ContactsStore | null,
  contactsContainerId: string | null,
  appData: ReturnType<typeof useTearleadsRuntime>,
  tearleads: ReturnType<typeof useTearleads>,
): void {
  useEffect(() => {
    const userId = appData.auth.userId;
    if (!store || !contactsContainerId || !userId) {
      return;
    }

    let cancelled = false;
    void store.ensureSelfContact(userId).catch((error: unknown) => {
      if (!cancelled) {
        tearleads.logError(
          "Contacts: failed to auto-create self contact.",
          error,
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    appData.auth.userId,
    appData.crypto.signingFingerprint,
    contactsContainerId,
    store,
    tearleads,
  ]);
}

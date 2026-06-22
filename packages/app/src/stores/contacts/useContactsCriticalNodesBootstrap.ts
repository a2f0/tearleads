import {
  type ContainerContentsStore,
  type ContainerNode,
  deriveContainerSystemSlot,
} from "@tearleads/client-sdk";
import { bytesToBase64 } from "@tearleads/encoding";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useEffect, useState } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import {
  CONTACTS_CONTAINER_NAME,
  CONTACTS_CONTAINER_SYSTEM_SLOT_DEFINITION,
} from "../systemContainers";
import {
  type ContactsStore,
  type EnsureSelfContactInput,
  getSelfContactLocalId,
} from "./contactStore";

type ContactsContainerEnsurer = Pick<
  ContainerContentsStore,
  "ensureSystemContainer"
>;

export function getContactsContainerId(
  nodes: ReadonlyArray<Pick<ContainerNode, "id" | "systemSlot">> | null,
  contactsSystemSlot: ContainerSystemSlot | null,
): string | null {
  if (!contactsSystemSlot) {
    return null;
  }

  return (
    nodes?.find((node) => node.systemSlot === contactsSystemSlot)?.id ?? null
  );
}

export function useContactsSystemSlot(input: {
  logError: (message: string | Error, cause?: unknown) => void;
  signingPrivateKey: Uint8Array | null;
}): ContainerSystemSlot | null {
  const [contactsSystemSlot, setContactsSystemSlot] =
    useState<ContainerSystemSlot | null>(null);

  useEffect(() => {
    if (!input.signingPrivateKey) {
      setContactsSystemSlot(null);
      return;
    }

    let cancelled = false;
    void deriveContainerSystemSlot({
      definition: CONTACTS_CONTAINER_SYSTEM_SLOT_DEFINITION,
      secretKey: input.signingPrivateKey,
    })
      .then((systemSlot) => {
        if (!cancelled) {
          setContactsSystemSlot(systemSlot);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setContactsSystemSlot(null);
          input.logError("Failed to derive contacts system slot", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [input.logError, input.signingPrivateKey]);

  return contactsSystemSlot;
}

function useEnsureContactsContainer(input: {
  contactsContainerId: string | null;
  contactsSystemSlot: ContainerSystemSlot | null;
  containerContentsReady: boolean;
  containerContentsStore: ContactsContainerEnsurer;
  deferRemoteBootstrap?: boolean | undefined;
  logError: (message: string | Error, cause?: unknown) => void;
}): void {
  useEffect(() => {
    if (
      !input.contactsSystemSlot ||
      !input.containerContentsReady ||
      input.contactsContainerId !== null
    ) {
      return;
    }

    void input.containerContentsStore
      .ensureSystemContainer(
        input.contactsSystemSlot,
        CONTACTS_CONTAINER_NAME,
        {
          deferRemoteBootstrap: input.deferRemoteBootstrap,
          skipAdvancedManagedRoot: true,
        },
      )
      .catch((error) => {
        input.logError("Failed to ensure system contacts container", error);
      });
  }, [
    input.contactsContainerId,
    input.contactsSystemSlot,
    input.containerContentsReady,
    input.containerContentsStore,
    input.deferRemoteBootstrap,
    input.logError,
  ]);
}

function useEnsureSelfContact(input: {
  contactsContainerId: string | null;
  logError: (message: string | Error, cause?: unknown) => void;
  store: ContactsStore;
}): void {
  const appData = useTearleadsRuntime();
  const userId = appData.auth.userId;
  const signingFingerprint = appData.crypto.signingFingerprint;
  const localId = signingFingerprint
    ? getSelfContactLocalId(signingFingerprint)
    : null;
  const encapsulationPublicKey = appData.crypto.encapsulationKeyPair
    ? bytesToBase64(appData.crypto.encapsulationKeyPair.publicKey)
    : null;

  useEffect(() => {
    if (!input.contactsContainerId || (!localId && !userId)) {
      return;
    }
    const selfContact: EnsureSelfContactInput = {
      encapsulationPublicKey,
      localId,
      userId,
    };

    let cancelled = false;
    void input.store.ensureSelfContact(selfContact).catch((error: unknown) => {
      if (!cancelled) {
        input.logError("Contacts: failed to auto-create self contact.", error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    encapsulationPublicKey,
    input.contactsContainerId,
    input.logError,
    input.store,
    localId,
    userId,
  ]);
}

export function useContactsCriticalNodesBootstrap(input: {
  contactsContainerId: string | null;
  contactsStore: ContactsStore;
  contactsSystemSlot: ContainerSystemSlot | null;
  containerContentsReady: boolean;
  containerContentsStore: ContactsContainerEnsurer;
  deferRemoteBootstrap?: boolean | undefined;
}): void {
  const tearleads = useTearleads();

  useEnsureContactsContainer({
    contactsContainerId: input.contactsContainerId,
    contactsSystemSlot: input.contactsSystemSlot,
    containerContentsReady: input.containerContentsReady,
    containerContentsStore: input.containerContentsStore,
    deferRemoteBootstrap: input.deferRemoteBootstrap,
    logError: tearleads.logError,
  });
  useEnsureSelfContact({
    contactsContainerId: input.contactsContainerId,
    logError: tearleads.logError,
    store: input.contactsStore,
  });
}

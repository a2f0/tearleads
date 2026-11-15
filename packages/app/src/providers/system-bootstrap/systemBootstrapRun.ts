import type {
  ContainerContentsStore,
  ContainerNode,
  Tearleads,
} from "@tearleads/client-sdk";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  type EnsureSelfContactInput,
  getSelfContactLocalId,
} from "../../stores/contacts/contactStore";
import {
  createContactsRuntimeForContainer,
  getOrCreateContactsStoreForRuntime,
} from "../../stores/contacts/useContactsStoreForContainer";
import type { UserSystemContainer } from "../../stores/systemContainers";
import type { RuntimeSnapshot } from "../sdk/TearleadsProvider";
import { ensureSystemBootstrapContainer } from "./systemContainerBootstrap";

// The non-React core of system bootstrap: the provisioning run and its
// target-key derivation (the status machine is systemBootstrapMachine). Kept
// apart from the React provider so the hook/effect wiring in
// SystemBootstrapProvider stays legible and each file stays within budget;
// nothing here touches React.

export interface SystemBootstrapResult {
  readonly completed: boolean;
  readonly error?: unknown;
  readonly skipped?: boolean;
}

export interface SystemBootstrapRunInput {
  readonly appData: RuntimeSnapshot;
  readonly bootstrapContacts: boolean;
  readonly containerContentsStore: ContainerContentsStore;
  readonly systemContainers: ReadonlyArray<UserSystemContainer>;
  readonly targetKey: string;
  readonly tearleads: Tearleads;
}

function getSelfContactInput(input: {
  readonly appData: RuntimeSnapshot;
  readonly includeRemoteIdentity: boolean;
}): EnsureSelfContactInput | null {
  const { appData, includeRemoteIdentity } = input;
  const signingFingerprint = appData.crypto.signingFingerprint;
  const localId = signingFingerprint
    ? getSelfContactLocalId(signingFingerprint)
    : null;
  const userId = includeRemoteIdentity ? appData.auth.userId : null;

  if (!localId && !userId) {
    return null;
  }

  return {
    deferRemoteSync: !includeRemoteIdentity,
    encapsulationPublicKey:
      includeRemoteIdentity && appData.crypto.encapsulationKeyPair
        ? bytesToBase64(appData.crypto.encapsulationKeyPair.publicKey)
        : null,
    localId,
    userId,
  };
}

function canBootstrapRemoteSelfContactIdentity(
  appData: RuntimeSnapshot,
  contactsContainer: ContainerNode,
): boolean {
  return (
    appData.auth.isAuthenticated &&
    typeof appData.auth.userId === "string" &&
    contactsContainer.syncState.status === "synced"
  );
}

async function ensureSelfContact(input: {
  readonly appData: RuntimeSnapshot;
  readonly contactsContainer: ContainerNode;
  readonly tearleads: Tearleads;
}): Promise<boolean> {
  const selfContact = getSelfContactInput({
    appData: input.appData,
    includeRemoteIdentity: canBootstrapRemoteSelfContactIdentity(
      input.appData,
      input.contactsContainer,
    ),
  });
  if (!selfContact) {
    return false;
  }

  const documentsRuntime = input.tearleads.documents.workflowRuntime(
    input.contactsContainer.id,
  );
  const contactsRuntime = createContactsRuntimeForContainer(
    input.tearleads,
    documentsRuntime,
  );
  const contactsStore = getOrCreateContactsStoreForRuntime(
    input.tearleads,
    contactsRuntime,
  );
  contactsStore.updateRuntime(contactsRuntime);
  return (await contactsStore.ensureSelfContact(selfContact)) !== null;
}

export async function runSystemBootstrap(
  input: SystemBootstrapRunInput,
): Promise<boolean> {
  let contactsContainer: ContainerNode | null = null;

  for (const systemContainer of input.systemContainers) {
    if (systemContainer.kind === "contacts" && !input.bootstrapContacts) {
      continue;
    }
    if (systemContainer.provisionedAtOrganizationCreation) {
      // Born with the organization (provisioned server-side in the org creation
      // transaction), so it must NOT be created device-first: a second local
      // copy would carry the same per-user system slot as the server copy and
      // collide. It is hydrated post-auth by the dedicated root-lane pull in
      // SystemBootstrapProvider instead.
      continue;
    }
    const ensuredContainer = await ensureSystemBootstrapContainer({
      currentOrganizationId: input.appData.auth.organizationId,
      currentRootContainerId: input.appData.state.containerId,
      store: input.containerContentsStore,
      systemContainer,
    });
    if (systemContainer.kind === "contacts") {
      contactsContainer = ensuredContainer;
    }
  }

  if (!contactsContainer) {
    return !input.bootstrapContacts;
  }

  return ensureSelfContact({
    appData: input.appData,
    contactsContainer,
    tearleads: input.tearleads,
  });
}

export function createSystemBootstrapTargetKey(input: {
  readonly appData: RuntimeSnapshot;
  readonly bootstrapContacts: boolean;
  readonly contactsContainer: ContainerNode | null;
  readonly systemContainers: ReadonlyArray<UserSystemContainer>;
}): string {
  return [
    input.appData.infra.dbId ?? "db",
    input.appData.crypto.signingFingerprint ?? "key",
    input.appData.state.containerId ?? "root",
    input.appData.auth.organizationId ?? "local-org",
    input.appData.auth.userId ?? "local-user",
    // Key on the contacts container identity plus only the distinction that
    // changes what bootstrap does: ensureSelfContact upgrades the self contact
    // with its remote identity once Contacts is fully synced. Treat local-only
    // and pending the same so a freshly promoted Contacts container does not
    // re-run bootstrap while its create intent is still converging.
    input.bootstrapContacts && input.contactsContainer
      ? `${input.contactsContainer.id}:${
          canBootstrapRemoteSelfContactIdentity(
            input.appData,
            input.contactsContainer,
          )
            ? "remote"
            : "local"
        }`
      : input.bootstrapContacts
        ? "missing-contacts"
        : "contacts-disabled",
    input.systemContainers
      .map(
        (systemContainer) =>
          `${systemContainer.systemSlot}:${systemContainer.icon ?? ""}`,
      )
      .join(","),
  ].join(":");
}

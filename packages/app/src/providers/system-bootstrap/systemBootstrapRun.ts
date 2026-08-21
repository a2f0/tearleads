import type {
  ContainerContentsStore,
  ContainerNode,
  SymCrypt,
} from "@symcrypt/client-sdk";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  type EnsureSelfContactInput,
  getSelfContactLocalId,
} from "../../stores/contacts/contactStore";
import {
  createContactsRuntimeForContainer,
  getOrCreateContactsStoreForRuntime,
} from "../../stores/contacts/useContactsStoreForContainer";
import type { UserSystemContainer } from "../../stores/systemContainers";
import type { RuntimeSnapshot } from "../sdk/SymCryptProvider";
import { ensureSystemBootstrapContainer } from "./systemContainerBootstrap";

// The non-React core of system bootstrap: the provisioning run, its target-key
// derivation, and its status-state merge. Kept apart from the React provider so
// the hook/effect wiring in SystemBootstrapProvider stays legible and each file
// stays within budget; nothing here touches React.

export type SystemBootstrapStatus =
  | "idle"
  | "waiting"
  | "running"
  | "ready"
  | "error";

export interface SystemBootstrapResult {
  readonly completed: boolean;
  readonly error?: unknown;
  readonly skipped?: boolean;
}

export interface SystemBootstrapState {
  readonly error: unknown;
  // Latches once the first provisioning run for this scope completes. The gate
  // (isBootstrapping) only blanks the mini-app for that initial run; later
  // re-runs triggered by a converging container's syncState change must not
  // unmount an already-hydrated Explorer back to a loading screen.
  readonly hasCompleted: boolean;
  readonly status: SystemBootstrapStatus;
}

export interface SystemBootstrapRunInput {
  readonly appData: RuntimeSnapshot;
  readonly bootstrapContacts: boolean;
  readonly containerContentsStore: ContainerContentsStore;
  readonly systemContainers: ReadonlyArray<UserSystemContainer>;
  readonly targetKey: string;
  readonly symcrypt: SymCrypt;
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
    lookupUserId: appData.auth.userId,
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
  readonly symcrypt: SymCrypt;
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

  const documentsRuntime = input.symcrypt.documents.workflowRuntime(
    input.contactsContainer.id,
  );
  const contactsRuntime = createContactsRuntimeForContainer(
    input.symcrypt,
    documentsRuntime,
  );
  const contactsStore = getOrCreateContactsStoreForRuntime(
    input.symcrypt,
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
    symcrypt: input.symcrypt,
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

// Merge a status transition over the prior state so latched fields (hasCompleted)
// survive re-runs unless a transition explicitly resets them; clears the error by
// default since every non-error transition leaves the error state.
//
// Idempotent: returns the previous state (same reference) when the merge changes
// nothing so React bails out of the re-render. The driving effect re-asserts
// applyState({status:"ready"}) on EVERY bootstrapInput identity change even when the
// target key is already completed, and bootstrapInput is rebuilt on each store
// snapshot. The authenticated promotion pass makes system containers converge to
// remote, churning the snapshot, so this guard keeps those no-op re-assertions from
// re-rendering the whole provider subtree needlessly.
export function mergeSystemBootstrapState(
  previous: SystemBootstrapState,
  next: Partial<SystemBootstrapState> & { status: SystemBootstrapStatus },
): SystemBootstrapState {
  const merged = { ...previous, error: null, ...next };
  if (
    merged.status === previous.status &&
    merged.hasCompleted === previous.hasCompleted &&
    merged.error === previous.error
  ) {
    return previous;
  }
  return merged;
}

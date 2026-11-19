import type { Tearleads } from "@tearleads/client-sdk";
import {
  CONTACTS_CONTAINER_NAME,
  deriveUserSystemContainers,
  findUserSystemContainer,
} from "../../stores/systemContainers";

const STORE_READY_TIMEOUT_MS = 5_000;

// Poll a container-contents store to readiness. openTree() hydrates from local
// SQLite asynchronously; ensureSystemContainer must run against a ready tree.
async function waitForStoreReady(store: {
  getSnapshot: () => { ready: boolean };
}): Promise<void> {
  const deadline = Date.now() + STORE_READY_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    if (store.getSnapshot().ready) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Container contents store did not become ready.");
}

// Use the same identity-scoped Contacts folder as the Contacts mini-app.
export async function ensureContactsContainer(
  sdk: Tearleads,
  signingPrivateKey: Uint8Array,
): Promise<string> {
  const systemContainers = await deriveUserSystemContainers({
    signingPrivateKey,
    rootContainerId: sdk.session.containerId,
    organizationId: sdk.session.organizationId,
  });
  const contactsSystemContainer = findUserSystemContainer(
    systemContainers,
    "contacts",
  );
  if (!contactsSystemContainer) {
    throw new Error("Contacts system container definition is missing.");
  }
  const tree = sdk.containerContents.openTree();
  // openTree() does not hydrate on its own; the app drives it via updateRuntime
  // when the runtime changes. Push the current runtime once, then refresh from
  // the local root so the store reports ready.
  tree.updateRuntime(sdk.containerContents.workflowRuntime());
  await tree.refreshLocalContainers();
  await waitForStoreReady(tree);
  const contactsNode = await tree.ensureSystemContainer(
    contactsSystemContainer.systemSlot,
    CONTACTS_CONTAINER_NAME,
    { icon: contactsSystemContainer.icon },
  );
  if (!contactsNode) {
    throw new Error("Failed to create the Contacts system container.");
  }
  return contactsNode.id;
}

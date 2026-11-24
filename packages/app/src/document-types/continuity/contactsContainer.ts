import type { Tearleads } from "@tearleads/client-sdk";
import {
  CONTACTS_CONTAINER_NAME,
  deriveUserSystemContainers,
  findUserSystemContainer,
} from "../../stores/systemContainers";

import { captureContinuityScope } from "./continuityScope";

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

export async function continuityContactsDefinition(sdk: Tearleads) {
  const { signingPrivateKey } =
    sdk.identity.requireSigningKeyPair("create Contacts");
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
  return contactsSystemContainer;
}

/**
 * The SDK's container tree, hydrated for a headless host. openTree() does not
 * hydrate on its own; the app drives it via updateRuntime when the runtime
 * changes. Push the current runtime once, then refresh from the local root so
 * the store reports ready.
 */
export async function openReadyContainerTree(
  sdk: Tearleads,
  scope: ReturnType<typeof captureContinuityScope>,
) {
  const tree = sdk.containerContents.openTree();
  tree.updateRuntime(scope.runtime);
  await tree.refreshLocalContainers();
  await waitForStoreReady(tree);
  scope.assertCurrent();
  return tree;
}

// Use the same identity-scoped Contacts folder as the Contacts mini-app.
export async function ensureContactsContainer(sdk: Tearleads): Promise<string> {
  const scope = captureContinuityScope(sdk);
  const contactsSystemContainer = await continuityContactsDefinition(sdk);
  scope.assertCurrent();
  const tree = await openReadyContainerTree(sdk, scope);
  const contactsNode = await tree.ensureSystemContainer(
    contactsSystemContainer.systemSlot,
    CONTACTS_CONTAINER_NAME,
    { icon: contactsSystemContainer.icon },
  );
  scope.assertCurrent();
  if (!contactsNode) {
    throw new Error("Failed to create the Contacts system container.");
  }
  return contactsNode.id;
}

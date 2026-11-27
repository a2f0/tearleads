import { afterEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { act } from "@testing-library/react";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  generatePaneKeyPairFromMenu,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import { openExplorer } from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import {
  downloadPaneRecoveryKey,
  restorePaneRecoveryKey,
} from "../../../../test/helpers/dual-pane/dualPaneRecoveryKit";
import { requestPath } from "../../../../test/helpers/dualPaneRequestSummary";
import { listProxiedApiRequests } from "../../../../test/helpers/msw/proxiedApi";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import {
  renderLifecyclePane,
  unmountLifecyclePane,
  waitForLifecycleConnection,
  waitForLifecycleQuiet,
} from "../../../../test/helpers/paneLifecycleTestUtils";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  waitForPaneRuntimeToSettle,
  waitForPersistedPaneLocalIdentity,
} from "../../../../test/helpers/paneTestUtils";
import { createPersistedPaneStorage } from "../../../../test/helpers/persistedPaneStorage";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import { waitForPersonalBootstrap } from "../../../../test/helpers/waitForPersonalBootstrap";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

const PARENT_LANES_PATH = "/containers/parent-lanes/query";
const CREATE_WITH_METADATA_PATH = "/containers/with-metadata-document";
const CONTACTS_FOLD_TIMEOUT_MS = 20_000;

function treeNodes(sdk: Tearleads) {
  return sdk.deviceFirst.open().containerStore.getSnapshot().nodes;
}

function contactsNodes(sdk: Tearleads) {
  return treeNodes(sdk).filter(
    (node) => node.systemSlot !== null && node.name === "Contacts",
  );
}

async function queuedCreateParents(sdk: Tearleads): Promise<unknown[]> {
  const rows = await sdk.runtime
    .input()
    .infra.execSql(
      "SELECT target_container_id FROM local_intents WHERE lane = 'container.create'",
    );
  return rows.map(({ target_container_id: parentId }) => parentId);
}

function listsChildrenOf(body: string, parentId: string): boolean {
  const parsed: { lanes?: Array<{ parentId?: unknown }> } = JSON.parse(body);
  return parsed.lanes?.some((lane) => lane.parentId === parentId) ?? false;
}

test(
  "a device reloaded after its restore folded the root folds its Contacts without posting it",
  async () => {
    // While set, every listing of the account root's children waits, as a
    // reload right after the restore boot's root fold leaves that listing.
    let heldParentId: string | null = null;
    const heldListings = Promise.withResolvers<void>();
    useTestApiAppHandlers({
      holdRequest: (request) => {
        const parentId = heldParentId;
        if (
          parentId === null ||
          new URL(request.url).pathname !== PARENT_LANES_PATH
        ) {
          return undefined;
        }
        return request
          .clone()
          .text()
          .then((body) =>
            listsChildrenOf(body, parentId) ? heldListings.promise : undefined,
          );
      },
    });

    const account = renderLifecyclePane(
      createTestHostConfig({
        autoProvisionIdentity: true,
        localIdentityNamespace: `restore-account-${crypto.randomUUID()}`,
      }),
    );
    await waitForSinglePaneProvisioning(account.pane);
    await waitForPersonalBootstrap();
    await openExplorer(account.pane);
    await waitForCondition(
      () => contactsNodes(account.sdk()).length === 1,
      "The account did not create its Contacts.",
      CONTACTS_FOLD_TIMEOUT_MS,
    );
    const [accountContacts] = contactsNodes(account.sdk());
    const rootId = accountContacts?.parentId;
    if (!accountContacts || !rootId) {
      throw new Error("The account's Contacts has no parent.");
    }
    await waitForLifecycleQuiet();
    const recoveryKey = await downloadPaneRecoveryKey(account.pane);
    await unmountLifecyclePane(account);

    const storage = createPersistedPaneStorage();
    const namespace = `restore-device-${crypto.randomUUID()}`;
    const hostConfig = createTestHostConfig({
      autoProvisionIdentity: false,
      localIdentityNamespace: namespace,
    }).withOverrides({ createSQLiteRuntime: storage.createRuntime });
    const restoring = renderLifecyclePane(hostConfig);
    await generatePaneKeyPairFromMenu(restoring.pane);
    await waitForCondition(
      () => contactsNodes(restoring.sdk()).length === 1,
      "The device did not make its own Contacts before the restore.",
      CONTACTS_FOLD_TIMEOUT_MS,
    );
    const start = listProxiedApiRequests().length;
    heldParentId = rootId;
    await restorePaneRecoveryKey(restoring.pane, recoveryKey);
    // The fold commits before the held listing, which the tree view waits on.
    await waitForCondition(
      async () => (await queuedCreateParents(restoring.sdk())).includes(rootId),
      "The restore boot did not fold its own root into the account root.",
      CONTACTS_FOLD_TIMEOUT_MS,
    );
    await waitForPersistedPaneLocalIdentity(namespace);

    // Reload before the held listing reaches the restore boot.
    restoring.view.unmount();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    heldParentId = null;
    heldListings.resolve();
    await waitForPaneRuntimeToSettle();

    const reloaded = renderLifecyclePane(hostConfig);
    await waitForLifecycleConnection(reloaded.sdk(), 1);
    await openExplorer(reloaded.pane);
    await waitForCondition(
      () => {
        const contacts = contactsNodes(reloaded.sdk());
        return contacts.length === 1 && contacts[0]?.id === accountContacts.id;
      },
      "The reloaded device did not fold its Contacts into the account's.",
      CONTACTS_FOLD_TIMEOUT_MS,
    );
    await waitForLifecycleQuiet();

    const creates = listProxiedApiRequests()
      .slice(start)
      .filter(
        (request) =>
          request.method === "POST" &&
          requestPath(request.url) === CREATE_WITH_METADATA_PATH,
      )
      .map((request) => `${request.status} ${request.responseBody}`);
    expect(creates).toEqual([]);
    await unmountLifecyclePane(reloaded);
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

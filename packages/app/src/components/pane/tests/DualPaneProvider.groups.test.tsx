import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { waitForAppTestRuntimeToSettle } from "../../../../test/helpers/appRuntimeIdle";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getPaneRoot,
  getPaneUserId,
  interact,
  listExplorerContainerItems,
  POST_SHARE_NETWORK_IDLE_QUIET_MS,
  POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
  renderDualPane,
  renderSinglePane,
  waitForDualPaneProvisioning,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  clickExplorerRefresh,
  createChildContainer,
  openExplorer,
  openExplorerContainerInfo,
  refreshUntil,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import {
  addPeerToAdminsGroup,
  createGroupAndAddPeer,
  createOrganizationGroup,
  findExplorerInfoGrantRow,
  openContainerInfoSharingTab,
  shareContainerWithGroup,
} from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import { waitForNoPostShareSyncFailures } from "../../../../test/helpers/dual-pane/dualPaneSyncKit";
import {
  requestPath,
  summarizeProxiedApiRequests,
} from "../../../../test/helpers/dualPaneRequestSummary";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { ORG_MANAGER_LABELS } from "../../../mini-apps/org-manager/labels";

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

test(
  "dual pane explorer opens after org manager imports peer into Admins",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);

    await addPeerToAdminsGroup(leftPane, getPaneUserId(rightPane));
    const postAdminAddRequestStartIndex = listProxiedApiRequests().length;
    await openExplorer(leftPane);

    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postAdminAddRequestStartIndex,
    );

    await openExplorer(rightPane);
    await refreshUntil(
      rightPane,
      () => listExplorerContainerItems(rightPane).length > 1,
      "Peer did not discover the Admins-granted root container.",
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "peer explorer opens directly after org manager imports peer into Admins",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);

    await addPeerToAdminsGroup(leftPane, getPaneUserId(rightPane));
    const postAdminAddRequestStartIndex = listProxiedApiRequests().length;

    await openExplorer(rightPane);
    await refreshUntil(
      rightPane,
      () => listExplorerContainerItems(rightPane).length > 1,
      "Peer did not discover the Admins-granted root container.",
    );
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postAdminAddRequestStartIndex,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "dual pane explorer discovers a root container shared to a newly created group",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");
    const groupName = "Pane 2 Readers";

    await waitForDualPaneProvisioning(leftPane, rightPane);

    await createGroupAndAddPeer(leftPane, groupName, getPaneUserId(rightPane));
    await openExplorer(rightPane);
    await openExplorer(leftPane);
    const postShareRequestStartIndex = listProxiedApiRequests().length;
    await shareContainerWithGroup(leftPane, "/", groupName, "read");

    await clickExplorerRefresh(rightPane);
    await refreshUntil(
      rightPane,
      () => {
        const containerNames = listExplorerContainerItems(rightPane).map(
          (button) => button.textContent?.trim() ?? "",
        );
        return (
          containerNames.length > 1 && !containerNames.includes("Untitled")
        );
      },
      "Peer did not hydrate the root container shared to the new group.",
    );
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postShareRequestStartIndex,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

// Regression: creating a child container under root immediately after granting
// a group read-only access to root used to fail. The group share rekeys root;
// the writer projection synthesized from the share mutation response did not
// carry the previous-epoch root manifest in its containerKek manifest history,
// so building the child-create plan against the cached parent projection threw
// "Container writer projection path[0] previous manifest <hash> is missing"
// before any request reached the server (the explorer surfaced "Failed to
// create child container"). A hard reload masked it by re-fetching a complete,
// verifiable root projection.

test(
  "explorer creates a child under root right after group-sharing root read-only",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");
    const groupName = "Pane 2 Readers";

    await waitForDualPaneProvisioning(leftPane, rightPane);

    await createGroupAndAddPeer(leftPane, groupName, getPaneUserId(rightPane));
    await openExplorer(rightPane);
    await openExplorer(leftPane);

    const postShareRequestStartIndex = listProxiedApiRequests().length;
    await shareContainerWithGroup(leftPane, "/", groupName, "read");

    await clickExplorerRefresh(rightPane);
    await refreshUntil(
      rightPane,
      () => {
        const containerNames = listExplorerContainerItems(rightPane).map(
          (button) => button.textContent?.trim() ?? "",
        );
        return (
          containerNames.length > 1 && !containerNames.includes("Untitled")
        );
      },
      "Peer did not hydrate the root container shared to the new group.",
    );

    // The previously-failing operation: peer1 creates a sub-container under root
    // after the group rekey. createChildContainer asserts the child appears.
    const childCreateRequestStartIndex = listProxiedApiRequests().length;
    await createChildContainer(leftPane, "Pane 1 sub container");

    const childCreateConflicts = listProxiedApiRequests()
      .slice(childCreateRequestStartIndex)
      .filter(
        (request) =>
          requestPath(request.url).endsWith(
            "/containers/with-metadata-document",
          ) && request.status === 409,
      );
    expect(
      childCreateConflicts,
      `Unexpected 409 on child create after group share.\nrequests=\n${summarizeProxiedApiRequests(
        listProxiedApiRequests().slice(childCreateRequestStartIndex),
      )}`,
    ).toEqual([]);
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postShareRequestStartIndex,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "grant row opens grant detail",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane();
    const leftPane = getPaneRoot(view, "left");
    const groupName = "Inspectors";

    await waitForSinglePaneProvisioning(leftPane);

    await createOrganizationGroup(leftPane, groupName);
    const directoryButton = within(leftPane).getByRole("button", {
      name: ORG_MANAGER_LABELS.directory,
    });
    await interact(() => {
      fireEvent.click(directoryButton);
    });
    await waitFor(() => {
      expect(within(leftPane).queryByLabelText("User ID")).toBeNull();
    });

    await openExplorer(leftPane);
    const postShareRequestStartIndex = listProxiedApiRequests().length;
    const sharedGroupId = await shareContainerWithGroup(
      leftPane,
      "/",
      groupName,
      "read",
    );
    await clickExplorerRefresh(leftPane);
    await act(async () => {
      await waitForAppTestRuntimeToSettle({
        apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
        timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
      });
    });
    await openExplorerContainerInfo(leftPane, "/");
    await openContainerInfoSharingTab(leftPane);
    const grantRow = await findExplorerInfoGrantRow(
      leftPane,
      sharedGroupId,
      groupName,
      "read",
    );

    await interact(() => {
      fireEvent.click(grantRow);
    });

    await waitFor(() => {
      expect(
        within(leftPane).getByText(ORG_MANAGER_LABELS.grantDetail),
      ).toBeTruthy();
    });
    await waitForNoPostShareSyncFailures(
      [leftPane],
      postShareRequestStartIndex,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

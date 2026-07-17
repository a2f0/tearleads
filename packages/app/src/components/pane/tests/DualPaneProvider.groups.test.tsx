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
  createNoteInContainer,
  editSelectedNoteText,
  openExplorer,
  openExplorerContainerInfo,
  refreshUntil,
  selectExplorerNoteByName,
  waitForExplorerNoteVisible,
  waitForSelectedNoteText,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import {
  addPeerToAdminsGroup,
  createGroupAndAddPeer,
  createOrganizationGroup,
  findExplorerInfoGrantRow,
  openContainerInfoSharingTab,
  shareContainerWithGroup,
} from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  capturePostShareSyncBaseline,
  waitForNoPostShareSyncFailures,
} from "../../../../test/helpers/dual-pane/dualPaneSyncKit";
import {
  requestPath,
  summarizeProxiedApiRequests,
} from "../../../../test/helpers/dualPaneRequestSummary";
import { dropNextMswServerEventWhere } from "../../../../test/helpers/mswEventRouter";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
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
    const postAdminAddBaseline = capturePostShareSyncBaseline();
    await openExplorer(leftPane);

    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postAdminAddBaseline,
    );

    await openExplorer(rightPane);
    await refreshUntil(
      rightPane,
      () => listExplorerContainerItems(rightPane).length > 1,
      "Peer did not discover the Admins-granted root container.",
    );
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postAdminAddBaseline,
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
    const postAdminAddBaseline = capturePostShareSyncBaseline();

    await openExplorer(rightPane);
    await refreshUntil(
      rightPane,
      () => listExplorerContainerItems(rightPane).length > 1,
      "Peer did not discover the Admins-granted root container.",
    );
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postAdminAddBaseline,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "peer explorer auto-surfaces an Admins-granted root without a manual refresh",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(leftPane, rightPane);

    // Open the peer explorer BEFORE the membership change so the only thing that
    // can surface the Admins-granted root is the incoming shared_with_you event
    // driving an automatic root re-list. Opening it after the add would mask the
    // event with the explorer's own one-shot open catch-up sweep, and a manual
    // refresh is exactly the crutch this fix removes.
    await openExplorer(rightPane);
    // Settle the peer's open catch-up first so the pre-add baseline is stable and
    // a still-in-flight sweep cannot pick up the membership after the add.
    await act(async () => {
      await waitForAppTestRuntimeToSettle({
        apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
        timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
      });
    });
    // The peer starts with only its own provisioned roots; access control keeps
    // the owner's Admins-granted root out of this list until the peer joins.
    const baselineRootCount = listExplorerContainerItems(rightPane).length;

    const postAdminAddBaseline = capturePostShareSyncBaseline();
    await addPeerToAdminsGroup(leftPane, getPaneUserId(rightPane));

    // No clickExplorerRefresh / refreshUntil here: the member-envelopes write
    // publishes a user-scoped shared_with_you, so the peer re-lists root
    // containers automatically and the Admins-granted root appears on its own.
    // Without the publish the peer issues no root re-list at all and this count
    // never grows (verified by disabling the publish).
    await waitForCondition(
      () => listExplorerContainerItems(rightPane).length > baselineRootCount,
      `Peer explorer did not auto-surface the Admins-granted root after the membership add (baseline=${baselineRootCount}). Expected shared_with_you to drive an automatic root re-list without a manual refresh.`,
    );
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postAdminAddBaseline,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "dual panes replicate a peer edit to an Admins-granted note",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");
    const initialNoteText = "Owner admin-shared note";
    const editedNoteText = "Peer two edited admin-shared note";

    await waitForDualPaneProvisioning(leftPane, rightPane);

    await addPeerToAdminsGroup(leftPane, getPaneUserId(rightPane));
    await openExplorer(leftPane);
    await createNoteInContainer(leftPane, "/", initialNoteText);
    await waitForSelectedNoteText(
      leftPane,
      initialNoteText,
      "Owner note editor did not show the created note.",
    );

    await openExplorer(rightPane);
    await waitForExplorerNoteVisible(rightPane, initialNoteText);
    await selectExplorerNoteByName(rightPane, initialNoteText);
    await waitForSelectedNoteText(
      rightPane,
      initialNoteText,
      "Peer note editor did not open the Admins-granted note.",
    );

    const peerEditBaseline = capturePostShareSyncBaseline();
    await editSelectedNoteText(rightPane, editedNoteText);
    await waitForCondition(
      () =>
        listProxiedApiRequests()
          .slice(peerEditBaseline.requestStartIndex)
          .some(
            (request) =>
              request.method === "POST" &&
              request.status === 200 &&
              /^\/documents\/[^/]+\/sync$/u.test(requestPath(request.url)),
          ),
      `Peer edit did not complete a successful document sync.\nrequests=\n${summarizeProxiedApiRequests(
        listProxiedApiRequests().slice(peerEditBaseline.requestStartIndex),
      )}`,
      15_000,
    );

    await waitForSelectedNoteText(
      leftPane,
      editedNoteText,
      "Owner did not receive the peer edit through the Admins group share.",
      20_000,
    );
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      peerEditBaseline,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "manual explorer refresh pulls a missed Admins-granted peer document update",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");
    const initialNoteText = "Owner admin-shared note";
    const editedNoteText = "Peer two edited admin-shared note without event";

    await waitForDualPaneProvisioning(leftPane, rightPane);

    await addPeerToAdminsGroup(leftPane, getPaneUserId(rightPane));
    await openExplorer(leftPane);
    await createNoteInContainer(leftPane, "/", initialNoteText);
    await waitForSelectedNoteText(
      leftPane,
      initialNoteText,
      "Owner note editor did not show the created note.",
    );

    await openExplorer(rightPane);
    await waitForExplorerNoteVisible(rightPane, initialNoteText);
    await selectExplorerNoteByName(rightPane, initialNoteText);
    await waitForSelectedNoteText(
      rightPane,
      initialNoteText,
      "Peer note editor did not open the Admins-granted note.",
    );

    // Simulate the owner missing the websocket invalidation for the peer's
    // committed edit. Manual refresh should still be able to pull the document
    // body over HTTP, so this test isolates the non-websocket recovery path.
    const droppedDocumentUpdates = dropNextMswServerEventWhere(
      (event) => Reflect.get(event, "type") === "document_update_created",
    );
    const peerEditBaseline = capturePostShareSyncBaseline();
    await editSelectedNoteText(rightPane, editedNoteText);
    await waitForCondition(
      () =>
        listProxiedApiRequests()
          .slice(peerEditBaseline.requestStartIndex)
          .some(
            (request) =>
              request.method === "POST" &&
              request.status === 200 &&
              /^\/documents\/[^/]+\/sync$/u.test(requestPath(request.url)),
          ),
      `Peer edit did not complete a successful document sync.\nrequests=\n${summarizeProxiedApiRequests(
        listProxiedApiRequests().slice(peerEditBaseline.requestStartIndex),
      )}`,
      15_000,
    );
    await waitForCondition(
      () => droppedDocumentUpdates() === 1,
      "Peer edit did not publish a dropped document_update_created event.",
      1_000,
    );

    await clickExplorerRefresh(leftPane);
    await waitForSelectedNoteText(
      leftPane,
      editedNoteText,
      "Owner manual refresh did not pull the peer edit after the websocket event was missed.",
      12_000,
    );
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      peerEditBaseline,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

test(
  "peer opens note content shared through a newly created group",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");
    const groupName = "Pane 2 Readers";
    const noteText = "Exact note content shared through a custom group";

    await waitForDualPaneProvisioning(leftPane, rightPane);

    await createGroupAndAddPeer(leftPane, groupName, getPaneUserId(rightPane));
    await openExplorer(leftPane);
    await createNoteInContainer(leftPane, "/", noteText);
    await openExplorer(rightPane);
    const postShareBaseline = capturePostShareSyncBaseline();
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
      postShareBaseline,
    );
    await waitForExplorerNoteVisible(rightPane, noteText);
    await selectExplorerNoteByName(rightPane, noteText);
    await waitForSelectedNoteText(
      rightPane,
      noteText,
      "Peer did not decrypt the exact note content shared through the new group.",
    );
    await waitForNoPostShareSyncFailures(
      [leftPane, rightPane],
      postShareBaseline,
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

    const postShareBaseline = capturePostShareSyncBaseline();
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
      postShareBaseline,
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
    const postShareBaseline = capturePostShareSyncBaseline();
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
        within(leftPane).getAllByText(ORG_MANAGER_LABELS.grantDetail),
      ).toHaveLength(2);
    });
    await waitForNoPostShareSyncFailures([leftPane], postShareBaseline);
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

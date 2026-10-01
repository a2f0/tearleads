import { afterEach, expect, test } from "bun:test";
import { cleanup, waitFor, within } from "@testing-library/react";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  DUAL_PANE_TEST_TIMEOUT_MS,
  getPaneRoot,
  renderSinglePane,
  selectContainerAndWaitForItemTable,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  createChildContainer,
  createNoteInContainer,
  moveContainer,
  openExplorer,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import {
  capturePostShareSyncBaseline,
  isDocumentWriterProjectionStaleContentBundleFailure,
  waitForNoPostShareSyncFailures,
} from "../../../../test/helpers/dual-pane/dualPaneSyncKit";
import { summarizeProxiedApiRequests } from "../../../../test/helpers/dualPaneRequestSummary";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";

const MOVED_NOTE_TITLE = "Moved folder note";

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

test(
  "dual pane explorer can move a child container under another sibling",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane();
    const leftPane = getPaneRoot(view, "left");

    await waitForSinglePaneProvisioning(leftPane);

    await openExplorer(leftPane);

    await createChildContainer(leftPane, "Target");
    await createChildContainer(leftPane, "Moved");

    await selectContainerAndWaitForItemTable(leftPane, "Target");
    await moveContainer(leftPane, "Moved", "Target");
    const targetTable = await selectContainerAndWaitForItemTable(
      leftPane,
      "Target",
    );

    await waitFor(() => {
      expect(
        within(targetTable).getByRole("button", { name: "Moved" }),
      ).toBeTruthy();
    });
  },
  DUAL_PANE_TEST_TIMEOUT_MS,
);

test(
  "moving a logged-in container with a note keeps document writer projection current",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane();
    const leftPane = getPaneRoot(view, "left");

    await waitForSinglePaneProvisioning(leftPane);

    await openExplorer(leftPane);

    await createChildContainer(leftPane, "Target");
    await createChildContainer(leftPane, "Moved");
    await createNoteInContainer(leftPane, "Moved", MOVED_NOTE_TITLE);

    const syncBaseline = capturePostShareSyncBaseline();
    await moveContainer(leftPane, "Moved", "Target");
    await waitForNoPostShareSyncFailures([leftPane], syncBaseline);

    const staleWriterProjectionRequests = listProxiedApiRequests()
      .slice(syncBaseline.requestStartIndex)
      .filter(isDocumentWriterProjectionStaleContentBundleFailure);

    expect(
      staleWriterProjectionRequests,
      `Container move should not leave document content-key bundles stale.\nrequests=\n${summarizeProxiedApiRequests(listProxiedApiRequests().slice(syncBaseline.requestStartIndex))}`,
    ).toEqual([]);
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

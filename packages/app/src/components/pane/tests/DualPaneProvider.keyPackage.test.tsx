import { afterEach, expect, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  destroyPaneKeyPackage,
  downloadPaneKeyPackageBackup,
  getPaneRoot,
  provisionPaneFromMenu,
  renderSinglePane,
  restorePaneKeyPackageBackup,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import { openOrgManager } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import { listPaneErrorLines } from "../../../../test/helpers/dual-pane/dualPaneSyncKit";
import {
  requestPath,
  summarizeProxiedApiRequests,
} from "../../../../test/helpers/dualPaneRequestSummary";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

test(
  "pane menu backs up and restores a registered key package",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane({
      autoProvision: false,
      developerMode: true,
    });
    const pane = getPaneRoot(view, "left");

    await provisionPaneFromMenu(pane);
    const backupJson = await downloadPaneKeyPackageBackup(pane);

    await destroyPaneKeyPackage(pane);

    const restoreRequestStartIndex = listProxiedApiRequests().length;
    await restorePaneKeyPackageBackup(pane, backupJson);
    await waitForCondition(
      () =>
        listProxiedApiRequests()
          .slice(restoreRequestStartIndex)
          .some(
            (request) =>
              request.method === "POST" &&
              request.status === 200 &&
              requestPath(request.url) === "/auth/verify",
          ),
      `Restored key package did not authenticate.\nrequests=\n${summarizeProxiedApiRequests()}`,
    );

    await openOrgManager(pane);

    expect(listPaneErrorLines([pane])).toEqual([]);
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

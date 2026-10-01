import { afterEach, expect, test } from "bun:test";
import { cleanup, within } from "@testing-library/react";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  generatePaneKeyPairFromMenu,
  getPaneRoot,
  getPaneUserId,
  renderDualPane,
  selectContainerAndWaitForItemTable,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  clickExplorerRefresh,
  createNoteWithAttachment,
  editSelectedNoteText,
  openExplorer,
  selectExplorerNoteByName,
  waitForSelectedNoteText,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import { documentSyncBatchSizes } from "../../../../test/helpers/dual-pane/dualPaneNoteSyncKit";
import {
  downloadPaneRecoveryKey,
  restorePaneRecoveryKey,
} from "../../../../test/helpers/dual-pane/dualPaneRecoveryKit";
import {
  capturePostShareSyncBaseline,
  waitForNoPostShareSyncFailures,
} from "../../../../test/helpers/dual-pane/dualPaneSyncKit";
import { dropNextMswServerEventWhere } from "../../../../test/helpers/mswEventRouter";
import {
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

for (const delayed of [false, true]) {
  test(
    `a recovered identity edits an attached note with ${delayed ? "delayed" : "live"} sync`,
    async () => {
      useTestApiAppHandlers();
      const view = renderDualPane({ autoProvisionRight: false });
      const primary = getPaneRoot(view, "left");
      const secondary = getPaneRoot(view, "right");
      const title = "Recovered editing";
      const attachmentName = "recovered-note.png";

      await waitForSinglePaneProvisioning(primary);
      await openExplorer(primary);
      await createNoteWithAttachment(primary, {
        attachmentContents: "attachment contents",
        attachmentName,
        containerName: "/",
        title,
      });
      await selectExplorerNoteByName(primary, title);
      const recoveryKey = await downloadPaneRecoveryKey(primary);
      await generatePaneKeyPairFromMenu(secondary);
      await restorePaneRecoveryKey(secondary, recoveryKey);
      await waitForCondition(
        () => getPaneUserId(secondary) === getPaneUserId(primary),
        "Recovered device did not restore the same user.",
        20_000,
      );
      await openExplorer(secondary);
      await selectContainerAndWaitForItemTable(secondary, "/");
      await selectExplorerNoteByName(secondary, title);
      await waitForSelectedNoteText(
        secondary,
        title,
        "Recovered device did not load the original note.",
      );
      await within(secondary).findByText(attachmentName);
      const baseline = capturePostShareSyncBaseline();

      let dropUpdates = delayed;
      const dropped = delayed
        ? Array.from({ length: 24 }, () =>
            dropNextMswServerEventWhere(
              (event) =>
                dropUpdates &&
                Reflect.get(event, "type") === "document_update_created",
            ),
          )
        : [];

      let text = `${title}\n`;
      for (const character of "abcdefghijklmnopqrstuvwx") {
        text += character;
        await editSelectedNoteText(secondary, text);
      }
      if (delayed) {
        await waitForNoPostShareSyncFailures([primary, secondary], baseline);
        dropUpdates = false;
        expect(
          dropped.reduce((count, read) => count + read(), 0),
        ).toBeGreaterThan(0);
        await waitForSelectedNoteText(
          primary,
          title,
          "Original device received an edit before revalidation.",
        );
        await clickExplorerRefresh(primary);
      }
      await waitForSelectedNoteText(
        primary,
        text,
        "Original device did not receive the recovered device's edits.",
      );
      if (delayed) {
        expect(documentSyncBatchSizes(baseline.requestStartIndex)).toContain(
          24,
        );
      }
      expect(within(primary).getByText(attachmentName)).toBeTruthy();
      await waitForNoPostShareSyncFailures([primary, secondary], baseline);
      await editSelectedNoteText(primary, `${text}\nOriginal device edit`);
      await waitForSelectedNoteText(
        secondary,
        `${text}\nOriginal device edit`,
        "Recovered device did not receive the original device's next edit.",
      );
      await waitForNoPostShareSyncFailures([primary, secondary], baseline);
    },
    DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  );
}

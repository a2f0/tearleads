import { afterEach, expect, test } from "bun:test";
import { cleanup, within } from "@testing-library/react";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  generatePaneKeyPairFromMenu,
  getExplorerWindowRoot,
  getPaneRoot,
  getPaneUserId,
  renderDualPane,
  selectContainerAndWaitForItemTable,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  clickExplorerRefresh,
  editSelectedNoteText,
  openExplorer,
  selectExplorerNoteByName,
  waitForSelectedNoteText,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import { openMiniApp } from "../../../../test/helpers/dual-pane/dualPaneMiniAppKit";
import {
  createBackspaceNote,
  documentSyncBatchSizes,
  type NoteEntryPoint,
  selectMiniAppNote,
} from "../../../../test/helpers/dual-pane/dualPaneNoteBackspaceKit";
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

const apps: readonly NoteEntryPoint[] = ["Notes", "Explorer"];
for (const creator of apps) {
  for (const editor of apps) {
    for (const delayed of [false, true]) {
      test(
        `${creator} note survives recovered ${editor} backspaces with ${delayed ? "delayed" : "live"} sync`,
        async () => {
          useTestApiAppHandlers();
          const view = renderDualPane({ autoProvisionRight: false });
          const primary = getPaneRoot(view, "left");
          const secondary = getPaneRoot(view, "right");
          const title = "Backspace recovery";
          const attachmentName = "backspace-note.png";
          const initialText = `${title}\n${"a".repeat(55)}`;

          await waitForSinglePaneProvisioning(primary);
          const originalWindow = await createBackspaceNote(
            primary,
            creator,
            title,
            attachmentName,
          );
          await editSelectedNoteText(originalWindow, initialText);
          const recoveryKey = await downloadPaneRecoveryKey(primary);

          // Keep Notes mounted across identity recovery.
          // Its automatic draft must not collide with the recovered note.
          await generatePaneKeyPairFromMenu(secondary);
          const recoveredNotes = await openMiniApp(secondary, "Notes");
          await restorePaneRecoveryKey(secondary, recoveryKey);
          await waitForCondition(
            () => getPaneUserId(secondary) === getPaneUserId(primary),
            "Recovery did not restore the same user.",
          );
          let recoveredWindow = recoveredNotes;
          if (editor === "Notes") {
            await selectMiniAppNote(recoveredNotes, title);
          } else {
            await openExplorer(secondary);
            await selectContainerAndWaitForItemTable(secondary, "/");
            recoveredWindow = getExplorerWindowRoot(secondary);
            await selectExplorerNoteByName(recoveredWindow, title);
          }
          await waitForSelectedNoteText(
            recoveredWindow,
            initialText,
            "Recovery did not load the note.",
          );
          await within(recoveredWindow).findByText(attachmentName);
          const baseline = capturePostShareSyncBaseline();
          await waitForNoPostShareSyncFailures([primary, secondary], baseline);

          let dropUpdates = delayed;
          const dropped = delayed
            ? Array.from({ length: 51 }, () =>
                dropNextMswServerEventWhere(
                  (event) =>
                    dropUpdates &&
                    Reflect.get(event, "type") === "document_update_created",
                ),
              )
            : [];
          let text = initialText;
          for (let count = 0; count < 51; count += 1) {
            text = text.slice(0, -1);
            await editSelectedNoteText(recoveredWindow, text);
            // Let each keystroke reach the server so this exercises 51
            // separate updates, even when the receiver misses every hint.
            await waitForNoPostShareSyncFailures(
              [primary, secondary],
              baseline,
            );
          }
          await waitForNoPostShareSyncFailures([primary, secondary], baseline);
          if (delayed) {
            dropUpdates = false;
            expect(dropped.reduce((count, read) => count + read(), 0)).toBe(51);
            await waitForSelectedNoteText(
              originalWindow,
              initialText,
              "Edits arrived before the delayed pull.",
            );
            if (creator === "Notes") await openExplorer(primary);
            await clickExplorerRefresh(primary);
          }
          // Check the sync diagnostics before the text so a rejection reports
          // its quarantine cause instead of only a stale editor timeout.
          await waitForNoPostShareSyncFailures([primary, secondary], baseline);
          await waitForSelectedNoteText(
            originalWindow,
            text,
            "Original device did not receive backspaces.",
          );
          if (delayed)
            expect(
              documentSyncBatchSizes(baseline.requestStartIndex),
            ).toContain(51);
          expect(within(originalWindow).getByText(attachmentName)).toBeTruthy();
          await editSelectedNoteText(
            originalWindow,
            `${text}\nOriginal device edit`,
          );
          await waitForSelectedNoteText(
            recoveredWindow,
            `${text}\nOriginal device edit`,
            "Recovered device did not receive the next edit.",
          );
          await waitForNoPostShareSyncFailures([primary, secondary], baseline);
        },
        DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
      );
    }
  }
}

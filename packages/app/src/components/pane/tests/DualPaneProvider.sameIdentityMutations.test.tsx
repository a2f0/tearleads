import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import { waitForAppTestRuntimeToSettle } from "../../../../test/helpers/appRuntimeIdle";
import {
  getPaneRoot,
  getPaneUserId,
  interact,
  readPaneRecoveryKey,
  renderDualPane,
  restorePaneFromRecoveryKey,
  selectContainerAndWaitForItemTable,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  clickExplorerRefresh,
  createNoteInContainer,
  createNoteWithAttachment,
  openExplorer,
  selectExplorerNoteByName,
  waitForExplorerNoteVisible,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
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

const ATTACHMENT_NAME = "peer-one.png";
const LIVE_NOTE_TITLE = "Peer one note with attachment";
const MISSED_PURGE_NOTE_TITLE = "Missed purge recovery note";
const SAME_IDENTITY_MUTATION_TIMEOUT_MS = 120_000;

function readPaneStatusValue(pane: HTMLElement, label: string): string {
  const rowHeader = within(pane).getByRole("rowheader", { name: label });
  const value = rowHeader.closest("tr")?.querySelector("td");
  invariant(value, `Expected ${label} status value.`);
  return value.textContent?.trim() ?? "";
}

async function restorePrimaryIdentityIntoSecondary(
  primaryPane: HTMLElement,
  secondaryPane: HTMLElement,
) {
  const primaryUserId = getPaneUserId(primaryPane);
  const primarySessionId = readPaneStatusValue(primaryPane, "Session");
  const recoveryKey = await readPaneRecoveryKey(primaryPane);
  await restorePaneFromRecoveryKey(secondaryPane, recoveryKey);

  await waitForCondition(
    () => getPaneUserId(secondaryPane) === primaryUserId,
    "Secondary pane did not switch to the primary identity.",
    20_000,
  );
  await waitForCondition(
    () => {
      const sessionId = readPaneStatusValue(secondaryPane, "Session");
      return sessionId !== "none" && sessionId !== primarySessionId;
    },
    "Secondary pane did not establish a distinct session.",
    20_000,
  );
  await waitForCondition(
    () => readPaneStatusValue(secondaryPane, "Web Socket") === "connected",
    "Secondary pane websocket did not reconnect after identity restore.",
    20_000,
  );
}

async function clickDocumentContextAction(
  itemButton: HTMLElement,
  actionName: "Delete Forever" | "Move to Trash",
) {
  const row = itemButton.closest("tr") ?? itemButton;
  await interact(() => {
    fireEvent.contextMenu(row, { clientX: 220, clientY: 220 });
  });
  const menu = document.querySelector<HTMLElement>(".menu");
  invariant(menu, `Expected ${actionName} document context menu.`);
  const action = await within(menu).findByRole("button", { name: actionName });
  await interact(() => {
    fireEvent.click(action);
  });
}

async function waitForItemAbsent(
  pane: HTMLElement,
  itemName: string,
  message: string,
) {
  await waitForCondition(
    () => {
      const table = within(pane).queryByRole("table", { name: /^Items in /u });
      return (
        table !== null &&
        within(table).queryByRole("button", { name: itemName }) === null
      );
    },
    `${message}\npane=${pane.textContent ?? "unknown"}`,
    30_000,
  );
}

async function waitForMutationRuntimesToSettle() {
  let settled = false;
  await act(async () => {
    settled = await waitForAppTestRuntimeToSettle({ timeoutMs: 6_000 });
  });
  expect(settled).toBe(true);
}

async function detachSelectedAttachmentAcrossSessions(
  primaryPane: HTMLElement,
  secondaryPane: HTMLElement,
) {
  // Attachment removal first syncs the CRDT marker, then commits the signed
  // detach. Drop the ordinary content-update hint so only the detach endpoint's
  // no-updateIds invalidation can wake the primary document store.
  const droppedContentUpdate = dropNextMswServerEventWhere(
    (event) =>
      Reflect.get(event, "type") === "document_update_created" &&
      Array.isArray(Reflect.get(event, "updateIds")),
  );
  const removeAttachment = within(secondaryPane).getByRole("button", {
    name: `Remove attachment ${ATTACHMENT_NAME}`,
  });
  await interact(() => {
    fireEvent.click(removeAttachment);
  });
  const removeDialog = await within(secondaryPane).findByRole("dialog", {
    name: "Remove attachment",
  });
  await interact(() => {
    fireEvent.click(
      within(removeDialog).getByRole("button", { name: "Remove" }),
    );
  });
  await waitForCondition(
    () => droppedContentUpdate() === 1,
    "Attachment removal did not publish the deliberately dropped content-update hint.",
    2_000,
  );
  await waitForCondition(
    () =>
      within(primaryPane).queryByText(ATTACHMENT_NAME) === null &&
      within(secondaryPane).queryByText(ATTACHMENT_NAME) === null,
    "Attachment detach did not converge to the primary session without Refresh.",
    15_000,
  );
}

interface SameIdentityTrashTables {
  secondary: HTMLElement;
}

async function moveNoteToTrashAcrossSessions(
  primaryPane: HTMLElement,
  secondaryPane: HTMLElement,
  noteTitle: string,
): Promise<SameIdentityTrashTables> {
  // Resolve each session's organization-aware Trash target before opening the
  // document action menu. The menu intentionally hides destructive actions
  // until this system-container lookup has settled.
  await selectContainerAndWaitForItemTable(primaryPane, "Trash");
  await selectContainerAndWaitForItemTable(secondaryPane, "Trash");
  await waitForMutationRuntimesToSettle();
  await selectContainerAndWaitForItemTable(primaryPane, "/");
  const secondaryRootTable = await selectContainerAndWaitForItemTable(
    secondaryPane,
    "/",
  );
  await waitFor(() => {
    expect(
      within(secondaryRootTable).getByRole("button", { name: noteTitle }),
    ).toBeTruthy();
  });
  const moveRequestStart = listProxiedApiRequests().length;
  await clickDocumentContextAction(
    within(secondaryRootTable).getByRole("button", { name: noteTitle }),
    "Move to Trash",
  );
  await waitForItemAbsent(
    secondaryPane,
    noteTitle,
    "Move to Trash did not update the initiating root view.",
  );
  await waitForCondition(
    () =>
      listProxiedApiRequests()
        .slice(moveRequestStart)
        .some(
          (request) =>
            request.status === 200 &&
            /^\/documents\/[^/]+\/unlink$/u.test(requestPath(request.url)),
        ),
    `Move to Trash did not commit its source unlink.\nrequests=\n${summarizeProxiedApiRequests(
      listProxiedApiRequests().slice(moveRequestStart),
    )}\npane=${secondaryPane.textContent ?? "unknown"}`,
    30_000,
  );
  // The context-menu action deliberately fires and forgets the device-first
  // move. Wait for its structural queue to commit before requiring the peer
  // session to have consumed the resulting websocket invalidation.
  await waitForMutationRuntimesToSettle();

  // The primary stays on its already-open root view. Its row must disappear
  // from the peer-session invalidation, without Refresh or reopening Explorer.
  await waitForItemAbsent(
    primaryPane,
    noteTitle,
    "Move to Trash did not update the primary root view.",
  );

  const primaryTrashTable = await selectContainerAndWaitForItemTable(
    primaryPane,
    "Trash",
  );
  const secondaryTrashTable = await selectContainerAndWaitForItemTable(
    secondaryPane,
    "Trash",
  );
  await waitFor(() => {
    expect(
      within(primaryTrashTable).getByRole("button", { name: noteTitle }),
    ).toBeTruthy();
    expect(
      within(secondaryTrashTable).getByRole("button", { name: noteTitle }),
    ).toBeTruthy();
  });
  return { secondary: secondaryTrashTable };
}

async function purgeNoteAcrossSessions(
  primaryPane: HTMLElement,
  tables: SameIdentityTrashTables,
  noteTitle: string,
) {
  await clickDocumentContextAction(
    within(tables.secondary).getByRole("button", { name: noteTitle }),
    "Delete Forever",
  );
  await waitForCondition(
    () =>
      within(tables.secondary).queryByRole("button", { name: noteTitle }) ===
      null,
    "Permanent purge did not update the initiating Trash view.",
    30_000,
  );
  await waitForMutationRuntimesToSettle();
  await waitForItemAbsent(
    primaryPane,
    noteTitle,
    "Permanent purge did not update the primary Trash view without Refresh.",
  );
}

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

test(
  "same-identity sessions converge detach, move-to-Trash, and purge without post-commit Refresh",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const primaryPane = getPaneRoot(view, "left");
    const secondaryPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(primaryPane, secondaryPane);
    await restorePrimaryIdentityIntoSecondary(primaryPane, secondaryPane);
    await openExplorer(secondaryPane);

    // Seed both remote documents before opening the observing primary Explorer.
    // Its normal initial reconciliation establishes the starting rows; after
    // that point only realtime invalidations may update the already-open view.
    await createNoteWithAttachment(secondaryPane);
    await createNoteInContainer(secondaryPane, "/", MISSED_PURGE_NOTE_TITLE);
    await openExplorer(primaryPane);
    await waitForExplorerNoteVisible(primaryPane, LIVE_NOTE_TITLE);
    await waitForExplorerNoteVisible(primaryPane, MISSED_PURGE_NOTE_TITLE);
    await selectExplorerNoteByName(primaryPane, LIVE_NOTE_TITLE);
    await selectExplorerNoteByName(secondaryPane, LIVE_NOTE_TITLE);
    await waitFor(() => {
      expect(within(primaryPane).getByText(ATTACHMENT_NAME)).toBeTruthy();
      expect(within(secondaryPane).getByText(ATTACHMENT_NAME)).toBeTruthy();
    });

    await detachSelectedAttachmentAcrossSessions(primaryPane, secondaryPane);
    await waitForMutationRuntimesToSettle();
    const liveTrashTables = await moveNoteToTrashAcrossSessions(
      primaryPane,
      secondaryPane,
      LIVE_NOTE_TITLE,
    );
    await purgeNoteAcrossSessions(
      primaryPane,
      liveTrashTables,
      LIVE_NOTE_TITLE,
    );

    // Prove a missed purge hint remains recoverable through the explicit HTTP
    // reconciliation path. This is a second committed document so the realtime
    // purge assertion above remains independent of the injected packet loss.
    const missedPurgeTrashTables = await moveNoteToTrashAcrossSessions(
      primaryPane,
      secondaryPane,
      MISSED_PURGE_NOTE_TITLE,
    );
    const droppedPurgeHint = dropNextMswServerEventWhere(
      (event) =>
        Reflect.get(event, "type") === "document_mutation_created" &&
        Reflect.get(event, "eventType") === "document.purge",
    );
    await clickDocumentContextAction(
      within(missedPurgeTrashTables.secondary).getByRole("button", {
        name: MISSED_PURGE_NOTE_TITLE,
      }),
      "Delete Forever",
    );
    await waitForCondition(
      () => droppedPurgeHint() === 1,
      "Permanent purge did not publish the deliberately dropped realtime hint.",
      2_000,
    );

    await clickExplorerRefresh(primaryPane);
    await waitForItemAbsent(
      primaryPane,
      MISSED_PURGE_NOTE_TITLE,
      "Explicit reconciliation did not recover the deliberately missed purge.",
    );
  },
  SAME_IDENTITY_MUTATION_TIMEOUT_MS,
);

import { expect } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { ORG_MANAGER_LABELS } from "../../../src/mini-apps/org-manager/labels";
import { settleAppTestRuntimeInAct } from "../appRuntimeIdle";
import {
  summarizeProxiedApiRequests,
  truncateText,
} from "../dualPaneRequestSummary";
import { createPeerIdentityLink } from "../identityLinkFixtures";
import { waitForCondition } from "../waitForCondition";
import {
  interact,
  openWindowMenuDialog,
  POST_SHARE_NETWORK_IDLE_QUIET_MS,
  POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
} from "./dualPaneCore";
import { openOrgManager } from "./dualPaneSharingKit";

const ORG_MANAGER_IMPORT_USER_TIMEOUT_MS = 10_000;

/**
 * Imports a peer user into the org roster via the org-manager "Import User" flow,
 * which routes through `organizations.addUserToGroup(memberGroupId)` and so makes
 * them an active member of the reserved Members group. Adding a member rotates
 * that group's key epoch, which is what fires the best-effort re-share of the org
 * metadata container to the new epoch. Assumes the caller is already an org admin
 * (e.g. the founder), so the File-menu action is permitted.
 */
export async function importPeerIntoRoster(
  pane: HTMLElement,
  peerUserId: string,
) {
  // The caller may already have the org manager open (e.g. from a preceding
  // Admins add); re-issuing the open gesture over an open window does not
  // re-surface its nav, so only open it when it is not already showing.
  if (!within(pane).queryByRole("button", { name: "Groups" })) {
    await openOrgManager(pane);
  }

  // "Import User" is a window File-menu item, disabled until the directory and
  // Members group have loaded (canImportRosterUser).
  const dialog = await openWindowMenuDialog({
    dialogName: ORG_MANAGER_LABELS.importUserAction,
    itemName: ORG_MANAGER_LABELS.importUserAction,
    scope: pane,
    timeoutMs: ORG_MANAGER_IMPORT_USER_TIMEOUT_MS,
  });
  const userIdInput = within(dialog).getByLabelText("Identity link");
  invariant(
    userIdInput instanceof HTMLInputElement,
    "Expected roster import user id input.",
  );
  const importButton = within(dialog).getByRole("button", {
    name: ORG_MANAGER_LABELS.importUserSubmitAction,
  });
  invariant(
    importButton instanceof HTMLButtonElement,
    "Expected roster import submit button.",
  );

  const identityLink = await createPeerIdentityLink(peerUserId);
  await interact(() => {
    fireEvent.change(userIdInput, { target: { value: identityLink } });
  });
  await waitFor(() => {
    expect(importButton.disabled).toBe(false);
  });
  await interact(() => {
    fireEvent.click(importButton);
  });

  // On success `importRosterUser` closes the dialog and selects the imported
  // user; wait for the dialog to close, then let sync settle. Selecting the
  // user can start a roster profile mutation whose completion must commit
  // before Org Manager releases the deferred organization hint.
  await waitForCondition(
    () =>
      within(pane).queryByRole("dialog", {
        name: ORG_MANAGER_LABELS.importUserAction,
      }) === null,
    `Roster import dialog for ${peerUserId} did not close.\nrequests=\n${summarizeProxiedApiRequests()}\npane=${truncateText(pane.textContent ?? "")}`,
  );
  expect(
    await settleAppTestRuntimeInAct({
      apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
      timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
    }),
    `Roster import for ${peerUserId} did not settle.\nrequests=\n${summarizeProxiedApiRequests()}`,
  ).toBe(true);
}

import { afterEach, expect, test } from "bun:test";
import { DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME } from "@tearleads/client-sdk";
import { cleanup, within } from "@testing-library/react";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getPaneRoot,
  getPaneUserId,
  renderDualPane,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  openExplorer,
  refreshUntil,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import { importPeerIntoRoster } from "../../../../test/helpers/dual-pane/dualPaneRosterKit";
import { addPeerToAdminsGroup } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import { waitForNoPostShareSyncFailures } from "../../../../test/helpers/dual-pane/dualPaneSyncKit";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

// The Explorer renders each foreign org's roots under a level-2 section heading
// showing the org's decrypted name once it resolves, or a generic "Shared with
// me" heading until then. A resolved per-org heading is a
// `<div role="heading" aria-level="2" class="explorer-sidebar-section-label">`.
function explorerSectionHeadings(pane: HTMLElement): string[] {
  return Array.from(
    pane.querySelectorAll(".explorer-sidebar-section-label"),
  ).map((element) => element.textContent?.trim() ?? "");
}

// End-to-end proof that a new roster member decrypts a foreign org's display
// name. This exercises the whole chain: Admins-group sync of the founder's
// containers, roster import into the Members group (which rotates the epoch,
// re-shares the metadata container, and pushes the org profile body), the
// reconciler pulling + decrypting the Members-granted metadata container's
// organization_profile document (a system-container document synced on every
// reconcile — see isSystemContainerNode), the reader's metadata-container name
// fallback resolving it, and useExplorerOrganizationNames re-resolving once the
// body lands to surface it as a per-org heading.
test(
  "a new roster member decrypts the founder org name and sees it as an explorer heading",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const founderPane = getPaneRoot(view, "left");
    const peerPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(founderPane, peerPane);

    // Two-step membership, mirroring the real flow:
    //   1. Admins group  -> the peer can read/sync the founder org's containers
    //      (its roots surface under a generic "Shared with me" heading).
    //   2. Roster import -> the peer joins the reserved Members group. That add
    //      rotates the Members key epoch, which fires the best-effort re-share of
    //      the org metadata container to the new epoch so the peer can DECRYPT the
    //      organization_profile document that holds the org display name.
    await addPeerToAdminsGroup(founderPane, getPaneUserId(peerPane));
    const postImportStartIndex = listProxiedApiRequests().length;
    await importPeerIntoRoster(founderPane, getPaneUserId(peerPane));

    await openExplorer(peerPane);

    // A full-crawl refresh pulls the newly Members-granted metadata container and
    // its organization_profile document; `useExplorerOrganizationNames` then fills
    // the org-name map asynchronously and re-labels the founder roots from "Shared
    // with me" to the org name. Poll with refreshUntil because the heading lands a
    // beat after the container/doc sync.
    //
    // This is the regression the reader fix unblocks end to end: before it, the
    // synced profile document was keyed under its server documentId rather than the
    // provisioner-only `org-profile:<id>` alias, so readLocalOrganizationName never
    // found a foreign org's name and this heading never appeared.
    await refreshUntil(
      peerPane,
      () =>
        explorerSectionHeadings(peerPane).includes(
          DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
        ),
      "Peer did not surface the founder org name heading after joining the roster.",
      20_000,
    );

    // Both orgs seed the same default name, but the peer's own org is the primary
    // (rendered without a heading), so a "Personal Org" *heading* is unambiguously
    // the foreign founder org whose name has now decrypted.
    expect(
      within(peerPane).getByRole("heading", {
        level: 2,
        name: DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
      }),
    ).toBeTruthy();

    await waitForNoPostShareSyncFailures(
      [founderPane, peerPane],
      postImportStartIndex,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

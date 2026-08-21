import { afterEach, expect, test } from "bun:test";
import { DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME } from "@symcrypt/client-sdk";
import { cleanup, within } from "@testing-library/react";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getExplorerSidebarItemsByName,
  getPaneRoot,
  getPaneUserId,
  provisionPaneFromMenu,
  renderDualPane,
  waitForDualPaneProvisioning,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  createChildContainer,
  openExplorer,
  refreshUntil,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import { importPeerIntoRoster } from "../../../../test/helpers/dual-pane/dualPaneRosterKit";
import { addPeerToAdminsGroup } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  capturePostShareSyncBaseline,
  waitForNoPostShareSyncFailures,
} from "../../../../test/helpers/dual-pane/dualPaneSyncKit";
import {
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";

const PEER_PERSONAL_MARKER = "Peer Personal Marker";

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
  "a new roster member keeps its personal org primary above the decrypted founder org",
  async () => {
    useTestApiAppHandlers();
    // Provision serially to reproduce the real two-browser sequence: the
    // founder's server root predates the peer's local personal root. The old
    // first-created-root heuristic therefore promoted the newly shared founder
    // org on the peer even though it was only discovered after both bootstraps.
    const view = renderDualPane({ autoProvisionRight: false });
    const founderPane = getPaneRoot(view, "left");
    const peerPane = getPaneRoot(view, "right");

    await waitForSinglePaneProvisioning(founderPane);
    await provisionPaneFromMenu(peerPane);
    await waitForDualPaneProvisioning(founderPane, peerPane);

    // Give the peer's own tree an unambiguous marker. Both root rows are named
    // "/" and both organizations use the default profile name, so the prior
    // heading-only assertion could pass with the two orgs transposed.
    await openExplorer(peerPane);
    await createChildContainer(peerPane, PEER_PERSONAL_MARKER);

    // Two-step membership, mirroring the real flow:
    //   1. Roster import -> the peer joins the reserved Members group. That add
    //      rotates the Members key epoch, which fires the best-effort re-share of
    //      the org metadata container to the new epoch so the peer can DECRYPT the
    //      organization_profile document that holds the org display name.
    //   2. Admins group  -> the peer can read/sync the founder org's containers
    //      (its roots surface under the decrypted organization heading).
    await importPeerIntoRoster(founderPane, getPaneUserId(peerPane));
    const postAdminGrantBaseline = capturePostShareSyncBaseline();
    await addPeerToAdminsGroup(founderPane, getPaneUserId(peerPane));

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

    const personalMarker = getExplorerSidebarItemsByName(
      peerPane,
      PEER_PERSONAL_MARKER,
    )[0];
    const founderHeading = within(peerPane).getByRole("heading", {
      level: 2,
      name: DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
    });
    expect(personalMarker).toBeTruthy();
    expect(personalMarker?.compareDocumentPosition(founderHeading) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    await waitForNoPostShareSyncFailures(
      [founderPane, peerPane],
      postAdminGrantBaseline,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

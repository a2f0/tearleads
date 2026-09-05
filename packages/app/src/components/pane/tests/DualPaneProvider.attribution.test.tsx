import { afterEach, expect, test } from "bun:test";
import {
  isDocumentEditAttributionResponse,
  isListDocumentEditAttributionRangesResponse,
} from "@tearleads/validators/response";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getExplorerSidebarItem,
  getPaneRoot,
  getPaneUserId,
  interact,
  renderDualPane,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  clickExplorerRefresh,
  createChildContainer,
  createNoteInContainer,
  editSelectedNoteText,
  openExplorer,
  selectExplorerNoteByName,
  selectPeerSharedContainer,
  waitForSelectedNoteText,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import { importPeerIntoRoster } from "../../../../test/helpers/dual-pane/dualPaneRosterKit";
import { shareContainerWithPeer } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForPaneRuntimeToSettle } from "../../../../test/helpers/paneTestUtils";

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

async function openNoteInfo(pane: HTMLElement, title: string) {
  await interact(() => {
    fireEvent.contextMenu(getExplorerSidebarItem(pane, title), {
      clientX: 200,
      clientY: 200,
    });
  });
  const menu = document.querySelector<HTMLElement>(".menu");
  invariant(menu, "Expected note context menu.");
  await interact(() => {
    fireEvent.click(within(menu).getByRole("button", { name: "Get Info" }));
  });
  await within(pane).findByText("Document Info");
}

async function expectNoteAttribution(
  pane: HTMLElement,
  title: string,
  writerUserIds: string[],
) {
  await clickExplorerRefresh(pane);
  const requestStartIndex = listProxiedApiRequests().length;
  await openNoteInfo(pane, title);
  await waitFor(() => {
    const heading = within(pane).getByRole("heading", { name: "Contributors" });
    const section = heading.parentElement;
    invariant(section, "Expected contributors section.");
    expect(section.querySelectorAll("tbody tr").length).toBe(
      writerUserIds.length,
    );
    for (const writerUserId of writerUserIds) {
      expect(
        section.querySelector(`[title*="${writerUserId}"]`),
      ).not.toBeNull();
    }
  });
  expect(
    within(pane).queryByText(/Edit attribution could not be loaded/u),
  ).toBeNull();
  const request = listProxiedApiRequests()
    .slice(requestStartIndex)
    .find((request) => request.url.endsWith("/attribution"));
  invariant(
    request?.authorization,
    "Expected an authenticated attribution request.",
  );
  expect(request.status, request.responseBody).toBe(200);
  const compact: unknown = JSON.parse(request.responseBody);
  invariant(
    isDocumentEditAttributionResponse(compact),
    "Expected attribution segments.",
  );
  expect(compact.truncated).toBe(false);
  expect(
    [
      ...new Set(compact.segments.map((segment) => segment.writerUserId)),
    ].sort(),
  ).toEqual([...writerUserIds].sort());
  expect(
    compact.segments.every((segment) => segment.authorityKind === "direct"),
  ).toBe(true);

  // Follow revision-bound pages using this pane's session. A one-item limit
  // exercises pagination across both writers and their actual signed uploads.
  const rangeWriters = new Set<string>();
  let cursor: string | null = null;
  do {
    const url = new URL(`${request.url}/ranges`);
    url.searchParams.set(
      "expectedRevision",
      String(compact.attributionRevision),
    );
    url.searchParams.set("limit", "1");
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      headers: { Authorization: request.authorization },
    });
    expect(response.status).toBe(200);
    const page: unknown = await response.json();
    invariant(
      isListDocumentEditAttributionRangesResponse(page),
      "Expected detailed attribution page.",
    );
    expect(page.attributionRevision).toBe(compact.attributionRevision);
    expect(page.items.length).toBe(1);
    for (const item of page.items) {
      rangeWriters.add(item.writerUserId);
      expect(item.authorityKind).toBe("direct");
      expect(item.updateId.length).toBeGreaterThan(0);
    }
    expect(page.hasMore).toBe(page.nextCursor !== null);
    cursor = page.nextCursor;
  } while (cursor !== null);
  expect([...rangeWriters].sort()).toEqual([...writerUserIds].sort());
  return compact;
}

test(
  "shared note attribution loads for both peers after editing and refreshing",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const leftPane = getPaneRoot(view, "left");
    const rightPane = getPaneRoot(view, "right");
    await waitForDualPaneProvisioning(leftPane, rightPane);
    const writerUserIds = [getPaneUserId(leftPane), getPaneUserId(rightPane)];
    await importPeerIntoRoster(leftPane, getPaneUserId(rightPane));
    await openExplorer(leftPane);
    await openExplorer(rightPane);
    await createChildContainer(leftPane, "Attribution");
    const title = "Shared attribution note";
    await createNoteInContainer(leftPane, "Attribution", title);
    await waitForPaneRuntimeToSettle();
    const ownerAttribution = await expectNoteAttribution(leftPane, title, [
      getPaneUserId(leftPane),
    ]);
    await shareContainerWithPeer(leftPane, "Attribution");
    await selectPeerSharedContainer(rightPane, "Attribution");
    await selectExplorerNoteByName(rightPane, title);
    const editedText = `${title}\nEdited by peer two`;
    await editSelectedNoteText(rightPane, editedText);
    await selectExplorerNoteByName(leftPane, title);
    await waitForSelectedNoteText(
      leftPane,
      editedText,
      "Peer one did not receive peer two's edit.",
    );

    await waitForPaneRuntimeToSettle();
    const sharedAttribution = await expectNoteAttribution(
      leftPane,
      title,
      writerUserIds,
    );
    expect(sharedAttribution.attributionRevision).toBeGreaterThan(
      ownerAttribution.attributionRevision,
    );
    expect(
      await expectNoteAttribution(rightPane, title, writerUserIds),
    ).toEqual(sharedAttribution);

    await selectExplorerNoteByName(leftPane, title);
    const ownerEditedText = `${editedText}\nEdited again by peer one`;
    await editSelectedNoteText(leftPane, ownerEditedText);
    await selectExplorerNoteByName(rightPane, title);
    await waitForSelectedNoteText(
      rightPane,
      ownerEditedText,
      "Peer two did not receive peer one's edit.",
    );
    await waitForPaneRuntimeToSettle();
    const refreshedAttribution = await expectNoteAttribution(
      rightPane,
      title,
      writerUserIds,
    );
    expect(refreshedAttribution.attributionRevision).toBeGreaterThan(
      sharedAttribution.attributionRevision,
    );
    expect(await expectNoteAttribution(leftPane, title, writerUserIds)).toEqual(
      refreshedAttribution,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

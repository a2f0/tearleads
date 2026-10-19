import { afterEach, expect, test } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import {
  getExplorerSidebarItem,
  getPaneRoot,
  interact,
  renderSinglePane,
  selectContainerAndWaitForItemTable,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  createChildContainer,
  createNoteInContainer,
  openExplorer,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import {
  requestPath,
  summarizeProxiedApiRequests,
} from "../../../../test/helpers/dualPaneRequestSummary";
import {
  listProxiedApiRequests,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { cleanupPaneTestEnvironment } from "../../../../test/helpers/paneTestUtils";
import { waitForPersonalBootstrap } from "../../../../test/helpers/waitForPersonalBootstrap";

afterEach(cleanupPaneTestEnvironment);

const FOLDER_NAME = "Trash race folder";
const NOTE_TITLE = "Trash race note";
const TRASH_PURGE_TIMEOUT_MS = 120_000;

async function clickContextAction(item: HTMLElement, name: string) {
  await interact(() => {
    fireEvent.contextMenu(item.closest("tr") ?? item, {
      clientX: 220,
      clientY: 220,
    });
  });
  const menu = document.querySelector<HTMLElement>(".menu");
  invariant(menu, `Expected a context menu offering ${name}.`);
  const action = await within(menu).findByRole("button", { name });
  await waitFor(() => {
    expect(action.hasAttribute("disabled")).toBe(false);
  });
  await interact(() => {
    fireEvent.click(action);
  });
}

async function confirmDialog(dialogName: string, submitName: string) {
  const dialog = await screen.findByRole("dialog", { name: dialogName });
  await interact(() => {
    fireEvent.click(within(dialog).getByRole("button", { name: submitName }));
  });
}

async function waitForPurgeOutcome(): Promise<string> {
  let outcome = "";
  await waitFor(
    () => {
      const status = document.querySelector(
        '[aria-labelledby="explorer-purge-progress-title"]',
      )?.textContent;
      if (status?.includes("Done.")) outcome = "done";
      else if (status?.includes("could not")) outcome = status;
      else if (status?.includes("Couldn't")) outcome = status;
      expect(outcome).not.toBe("");
    },
    { timeout: 60_000 },
  );
  return outcome;
}

function listMovePosts(startIndex: number) {
  return listProxiedApiRequests()
    .slice(startIndex)
    .filter(
      (request) =>
        request.method === "POST" &&
        /^\/containers\/[^/]+\/move$/u.test(requestPath(request.url)),
    );
}

async function renderReadyExplorer() {
  useTestApiAppHandlers();
  const pane = getPaneRoot(renderSinglePane(), "left");
  await waitForSinglePaneProvisioning(pane);
  await waitForPersonalBootstrap();
  await openExplorer(pane);
  return pane;
}

test(
  "Delete Forever right after Move to Trash waits for the folder move",
  async () => {
    const pane = await renderReadyExplorer();
    await createChildContainer(pane, FOLDER_NAME);
    await createNoteInContainer(pane, FOLDER_NAME, NOTE_TITLE);
    await selectContainerAndWaitForItemTable(pane, "/");
    const beforeMove = listProxiedApiRequests().length;

    await clickContextAction(
      getExplorerSidebarItem(pane, FOLDER_NAME),
      "Move to Trash",
    );
    const trash = await selectContainerAndWaitForItemTable(pane, "Trash");
    const trashedFolder = await within(trash).findByRole("button", {
      name: FOLDER_NAME,
    });
    // The move is still queued: its sync pass has not reached the server.
    expect(listMovePosts(beforeMove)).toHaveLength(0);
    await clickContextAction(trashedFolder, "Delete Forever");
    await confirmDialog("Delete Container Forever", "Delete Forever");

    const outcome = await waitForPurgeOutcome();
    const requests = summarizeProxiedApiRequests(
      listProxiedApiRequests().slice(beforeMove),
    );
    expect(outcome, requests).toBe("done");
    expect(listMovePosts(beforeMove), requests).toHaveLength(1);
  },
  TRASH_PURGE_TIMEOUT_MS,
);

test(
  "Empty Trash right after moving a note to Trash waits for the note move",
  async () => {
    const pane = await renderReadyExplorer();
    await createNoteInContainer(pane, "/", NOTE_TITLE);
    const root = await selectContainerAndWaitForItemTable(pane, "/");
    const beforeMove = listProxiedApiRequests().length;

    await clickContextAction(
      await within(root).findByRole("button", { name: NOTE_TITLE }),
      "Move to Trash",
    );
    const trash = await selectContainerAndWaitForItemTable(pane, "Trash");
    await within(trash).findByRole("button", { name: NOTE_TITLE });
    await clickContextAction(
      getExplorerSidebarItem(pane, "Trash"),
      "Empty Trash",
    );
    await confirmDialog("Empty Trash", "Empty Trash");

    const outcome = await waitForPurgeOutcome();
    expect(
      outcome,
      summarizeProxiedApiRequests(listProxiedApiRequests().slice(beforeMove)),
    ).toBe("done");
  },
  TRASH_PURGE_TIMEOUT_MS,
);

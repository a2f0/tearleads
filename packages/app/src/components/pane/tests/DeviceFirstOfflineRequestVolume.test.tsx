import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import {
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
  listProxiedApiRequests,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  waitForPaneRuntimeToSettle,
} from "../../../../test/helpers/paneTestUtils";
import { measureWorkflowRequests } from "../../../../test/helpers/workflowRequestBudget";

afterEach(cleanupPaneTestEnvironment);

test("offline folder creation, cached note edits and Trash use zero requests and resume after reconnect", async () => {
  useTestApiAppHandlers();
  const pane = getPaneRoot(renderSinglePane(), "left");
  await waitForSinglePaneProvisioning(pane);
  await openExplorer(pane);
  await createNoteInContainer(pane, "/", "Cached before outage");
  await waitForPaneRuntimeToSettle();
  await interact(() => {
    fireEvent(window, new Event("offline"));
  });

  await measureWorkflowRequests({
    label: "offline create folder",
    budget: { total: 0, byRequest: {} },
    mutations: [],
    operation: () => createChildContainer(pane, "Created without network"),
  });
  await measureWorkflowRequests({
    label: "offline edit cached note",
    budget: { total: 0, byRequest: {} },
    mutations: [],
    operation: async () => {
      const table = await selectContainerAndWaitForItemTable(pane, "/");
      await interact(() => {
        fireEvent.click(
          within(table).getByRole("button", { name: "Cached before outage" }),
        );
      });
      const editor = await within(pane).findByRole("textbox", {
        name: /Notes editor/u,
      });
      await interact(() => {
        fireEvent.change(editor, {
          target: { value: "Edited without network" },
        });
      });
      await selectContainerAndWaitForItemTable(pane, "Created without network");
      const reopened = await selectContainerAndWaitForItemTable(pane, "/");
      await within(reopened).findByRole("button", {
        name: "Edited without network",
      });
    },
  });
  await measureWorkflowRequests({
    label: "offline move cached note to Trash",
    budget: { total: 0, byRequest: {} },
    mutations: [],
    operation: async () => {
      const root = await selectContainerAndWaitForItemTable(pane, "/");
      const item = within(root).getByRole("button", {
        name: "Edited without network",
      });
      await interact(() => {
        fireEvent.contextMenu(item.closest("tr") ?? item, {
          clientX: 220,
          clientY: 220,
        });
      });
      const menu =
        pane.querySelector<HTMLElement>(".menu") ??
        document.querySelector<HTMLElement>(".menu");
      invariant(menu, "Expected note context menu");
      await interact(() => {
        fireEvent.click(
          within(menu).getByRole("button", { name: "Move to Trash" }),
        );
      });
      const trash = await selectContainerAndWaitForItemTable(pane, "Trash");
      await within(trash).findByRole("button", {
        name: "Edited without network",
      });
      const remaining = await selectContainerAndWaitForItemTable(pane, "/");
      await waitFor(() => {
        expect(
          within(remaining).queryByRole("button", {
            name: "Edited without network",
          }),
        ).toBeNull();
      });
    },
  });

  const reconnectStart = listProxiedApiRequests().length;
  await interact(() => {
    fireEvent(window, new Event("online"));
  });
  await waitFor(
    () => {
      const committed = listProxiedApiRequests()
        .slice(reconnectStart)
        .filter(
          (request) => request.method === "POST" && request.status === 200,
        );
      expect(
        committed.some((request) =>
          new URL(request.url).pathname.endsWith(
            "/containers/with-metadata-document",
          ),
        ),
      ).toBe(true);
      expect(
        committed.some((request) =>
          new URL(request.url).pathname.endsWith("/link"),
        ),
        JSON.stringify(
          listProxiedApiRequests()
            .slice(reconnectStart)
            .map((request) => [
              request.method,
              new URL(request.url).pathname,
              request.status,
            ]),
        ),
      ).toBe(true);
      expect(
        committed.some((request) =>
          new URL(request.url).pathname.endsWith("/unlink"),
        ),
      ).toBe(true);
    },
    { timeout: 20_000 },
  );
  await waitForPaneRuntimeToSettle();
  const trash = await selectContainerAndWaitForItemTable(pane, "Trash");
  await within(trash).findByRole("button", { name: "Edited without network" });
}, 60_000);

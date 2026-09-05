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
  moveContainer,
  openExplorer,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import { useTestApiAppHandlers } from "../../../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  waitForPaneRuntimeToSettle,
} from "../../../../test/helpers/paneTestUtils";
import { measureWorkflowRequests } from "../../../../test/helpers/workflowRequestBudget";

afterEach(cleanupPaneTestEnvironment);
const title = "Budget note";
const folder = "Budget folder";

async function contextAction(item: HTMLElement, name: string) {
  await interact(() => {
    fireEvent.contextMenu(item.closest("tr") ?? item, {
      clientX: 220,
      clientY: 220,
    });
  });
  const menu = document.querySelector<HTMLElement>(".menu");
  invariant(menu, "Expected document menu");
  const action = await within(menu).findByRole("button", { name });
  await waitFor(() => {
    expect(action.hasAttribute("disabled")).toBe(false);
  });
  await interact(() => {
    fireEvent.click(action);
  });
}
async function expectNote(pane: HTMLElement, name: string, present: boolean) {
  const table = await selectContainerAndWaitForItemTable(pane, name);
  await waitFor(() => {
    expect(within(table).queryByRole("button", { name: title }) !== null).toBe(
      present,
    );
  });
}

test("folder creation, document linking, unlinking and trash have separate request budgets", async () => {
  useTestApiAppHandlers();
  const pane = getPaneRoot(renderSinglePane(), "left");
  await waitForSinglePaneProvisioning(pane);
  await openExplorer(pane);
  await measureWorkflowRequests({
    label: "create child folder",
    operation: () => createChildContainer(pane, folder),
    budget: {
      total: 3,
      byRequest: {
        "GET /containers/:containerId/documents": 1,
        "POST /containers/with-metadata-document": 1,
        "POST /documents/:documentId/sync": 1,
      },
    },
    mutations: [
      {
        method: "POST",
        path: /^\/containers\/with-metadata-document$/u,
        count: 1,
      },
    ],
  });
  await createNoteInContainer(pane, "/", title);
  await selectContainerAndWaitForItemTable(pane, "/");
  await measureWorkflowRequests({
    label: "link document to folder",
    operation: async () => {
      const table = await selectContainerAndWaitForItemTable(pane, "/");
      await contextAction(
        within(table).getByRole("button", { name: title }),
        "Link",
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Link Document",
      });
      await interact(() => {
        fireEvent.click(
          within(dialog).getByRole("combobox", {
            name: "Destination container",
          }),
        );
      });
      const option = await within(dialog).findByRole("option", {
        name: folder,
      });
      await interact(() => {
        fireEvent.click(option);
      });
      await interact(() => {
        fireEvent.click(within(dialog).getByRole("button", { name: "Link" }));
      });
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      await expectNote(pane, folder, true);
      await expectNote(pane, "/", true);
    },
    budget: { total: 1, byRequest: { "POST /documents/:documentId/link": 1 } },
    mutations: [
      { method: "POST", path: /^\/documents\/[^/]+\/link$/u, count: 1 },
    ],
  });
  const table = await selectContainerAndWaitForItemTable(pane, "/");
  await contextAction(
    within(table).getByRole("button", { name: title }),
    "Get Info",
  );
  await interact(() => {
    fireEvent.click(within(pane).getByRole("tab", { name: "Links" }));
  });
  await measureWorkflowRequests({
    label: "unlink document from folder",
    operation: async () => {
      const detach = within(pane).getByRole("button", {
        name: `Detach linked container ${folder}`,
      });
      await waitFor(() => {
        expect(detach.hasAttribute("disabled")).toBe(false);
      });
      await interact(() => {
        fireEvent.click(detach);
      });
      await waitFor(
        () => {
          expect(
            within(pane).queryByRole("button", {
              name: `Detach linked container ${folder}`,
            }) === null,
          ).toBe(true);
        },
        { timeout: 15_000 },
      );
      await expectNote(pane, folder, false);
      await expectNote(pane, "/", true);
    },
    budget: {
      total: 3,
      byRequest: {
        "GET /documents/:documentId/writer-projection": 1,
        "POST /documents/:documentId/sync": 1,
        "POST /documents/:documentId/unlink": 1,
      },
    },
    mutations: [
      { method: "POST", path: /^\/documents\/[^/]+\/unlink$/u, count: 1 },
    ],
  });
  await selectContainerAndWaitForItemTable(pane, "Trash");
  await waitForPaneRuntimeToSettle();
  await selectContainerAndWaitForItemTable(pane, "/");
  await measureWorkflowRequests({
    label: "move document to trash",
    operation: async () => {
      const root = await selectContainerAndWaitForItemTable(pane, "/");
      await contextAction(
        within(root).getByRole("button", { name: title }),
        "Move to Trash",
      );
      await expectNote(pane, "/", false);
      await expectNote(pane, "Trash", true);
    },
    budget: {
      total: 5,
      byRequest: {
        "GET /containers/:containerId/writer-projection": 1,
        "GET /documents/:documentId/writer-projection": 1,
        "POST /documents/:documentId/link": 1,
        "POST /documents/:documentId/sync": 1,
        "POST /documents/:documentId/unlink": 1,
      },
    },
    mutations: [
      { method: "POST", path: /^\/documents\/[^/]+\/link$/u, count: 1 },
      { method: "POST", path: /^\/documents\/[^/]+\/unlink$/u, count: 1 },
    ],
  });
  await measureWorkflowRequests({
    label: "move folder to trash",
    operation: async () => {
      await contextAction(
        getExplorerSidebarItem(pane, folder),
        "Move to Trash",
      );
      const trash = await selectContainerAndWaitForItemTable(pane, "Trash");
      await waitFor(() => {
        expect(
          within(trash).queryByRole("button", { name: folder }) !== null,
        ).toBe(true);
      });
    },
    budget: {
      total: 6,
      byRequest: {
        "GET /containers/:containerId/documents": 1,
        "GET /containers/:containerId/writer-projection": 0,
        "GET /documents/:documentId/writer-projection": 1,
        "GET /organizations/:organizationId/read-model": 1,
        "POST /containers/:containerId/move": 1,
        "POST /containers/parent-lanes/query": 1,
        "POST /documents/:documentId/sync": 1,
      },
    },
    mutations: [
      { method: "POST", path: /^\/containers\/[^/]+\/move$/u, count: 1 },
    ],
  });
  await measureWorkflowRequests({
    label: "restore folder from trash",
    operation: async () => {
      await moveContainer(pane, folder, "/");
      const root = await selectContainerAndWaitForItemTable(pane, "/");
      await waitFor(() => {
        expect(
          within(root).queryByRole("button", { name: folder }) !== null,
        ).toBe(true);
      });
    },
    budget: {
      total: 8,
      byRequest: {
        "GET /containers/:containerId/documents": 1,
        "GET /containers/:containerId/writer-projection": 2,
        "GET /documents/:documentId/writer-projection": 1,
        "GET /organizations/:organizationId/read-model": 1,
        "POST /containers/:containerId/move": 1,
        "POST /containers/parent-lanes/query": 1,
        "POST /documents/:documentId/sync": 1,
      },
    },
    mutations: [
      { method: "POST", path: /^\/containers\/[^/]+\/move$/u, count: 1 },
    ],
  });
}, 90_000);

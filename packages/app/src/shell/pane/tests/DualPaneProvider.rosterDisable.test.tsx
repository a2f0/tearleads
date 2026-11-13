import { afterEach, expect, spyOn, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import {
  getPaneUserId,
  interact,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import { renderSeededDemo } from "../../../../test/helpers/dual-pane/dualPaneMiniAppKit";
import { importPeerIntoRoster } from "../../../../test/helpers/dual-pane/dualPaneRosterKit";
import { addPeerToAdminsGroup } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import { dropNextMswServerEventWhere } from "../../../../test/helpers/msw/eventRouter";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import { ORG_MANAGER_LABELS } from "../../../mini-apps/org-manager/labels";

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

test.each(["none", "read", "commit"] as const)(
  "roster status follows the committed membership without a reload (failure: %s)",
  async (failure) => {
    useTestApiAppHandlers();
    const { leftPane, rightPane, leftRuntime } = await renderSeededDemo();
    const peerUserId = getPaneUserId(rightPane);
    await addPeerToAdminsGroup(leftPane, peerUserId);
    await interact(() => {
      fireEvent.click(
        within(leftPane).getByRole("button", {
          name: ORG_MANAGER_LABELS.directory,
        }),
      );
    });
    const row = await waitFor(() => {
      const label = within(leftPane).getByTitle(peerUserId);
      const row = label.closest("tr");
      invariant(row, "Expected the peer's roster row.");
      expect(within(row).getByText(ORG_MANAGER_LABELS.active)).toBeTruthy();
      return row;
    });
    const directory =
      await leftRuntime.organizations.loadLocalDirectoryAndGroups();
    invariant(directory, "Expected the founder's directory.");
    // Hints are optional. The author's own mutation result must refresh the UI.
    const dropped = [0, 1].map(() =>
      dropNextMswServerEventWhere(
        (event) =>
          Reflect.get(event, "type") === "organization_read_model_changed" &&
          Reflect.get(event, "organizationId") ===
            directory.directory.organizationId,
      ),
    );
    const originalFetch = globalThis.fetch;
    let committed = false;
    let failedReads = 0;
    let rejectedCommits = 0;
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (...args: Parameters<typeof fetch>) => {
          const request = new Request(...args);
          const path = new URL(request.url).pathname;
          if (
            failure === "read" &&
            committed &&
            failedReads === 0 &&
            path ===
              `/organizations/${directory.directory.organizationId}/read-model`
          ) {
            failedReads += 1;
            return new Response(null, { status: 503 });
          }
          if (
            failure === "commit" &&
            request.method === "PUT" &&
            path.includes(directory.memberGroupId) &&
            path.endsWith("/policy-commit")
          ) {
            rejectedCommits += 1;
            return new Response(null, { status: 503 });
          }
          const response = await originalFetch(...args);
          if (
            request.method === "PUT" &&
            path.includes(directory.memberGroupId) &&
            path.endsWith("/policy-commit") &&
            response.ok
          )
            committed = true;
          return response;
        },
        { preconnect: originalFetch.preconnect },
      ),
    );
    try {
      expect(leftPane.querySelector(".mini-app-status--error")).toBeNull();
      await interact(() => {
        fireEvent.contextMenu(row, { clientX: 200, clientY: 200 });
      });
      await interact(() => {
        fireEvent.click(
          screen.getByRole("button", {
            name: ORG_MANAGER_LABELS.disableRosterEntryAction,
          }),
        );
      });
      if (failure === "commit") {
        await waitFor(
          () => {
            expect(rejectedCommits).toBe(1);
            expect(
              leftPane.querySelector(".mini-app-status--error")?.textContent,
            ).toBeTruthy();
          },
          { timeout: 20_000 },
        );
        expect(rejectedCommits).toBe(1);
        expect(committed).toBe(false);
        expect(within(row).getByText(ORG_MANAGER_LABELS.active)).toBeTruthy();
        expect(within(row).queryByText(ORG_MANAGER_LABELS.disabled)).toBeNull();
        return;
      }
      await waitFor(
        () => {
          const label = within(leftPane).getByTitle(peerUserId);
          const updatedRow = label.closest("tr");
          invariant(updatedRow, "Expected the peer's retained roster row.");
          expect(
            within(updatedRow).getByText(ORG_MANAGER_LABELS.disabled),
          ).toBeTruthy();
        },
        { timeout: 20_000 },
      );
      expect(committed).toBe(true);
      expect(failedReads).toBe(failure === "read" ? 1 : 0);
      expect(dropped.map((count) => count())).toEqual([1, 1]);

      // Re-importing re-enables the same member through the shared refresh path.
      committed = false;
      failedReads = 0;
      const droppedEnableHint = dropNextMswServerEventWhere(
        (event) =>
          Reflect.get(event, "type") === "organization_read_model_changed" &&
          Reflect.get(event, "organizationId") ===
            directory.directory.organizationId,
      );
      await importPeerIntoRoster(leftPane, peerUserId);
      await interact(() =>
        fireEvent.click(
          within(leftPane).getByRole("button", {
            name: ORG_MANAGER_LABELS.back,
          }),
        ),
      );
      const enabledRow = within(leftPane).getByTitle(peerUserId).closest("tr");
      invariant(enabledRow, "Expected the re-enabled user's roster row.");
      expect(
        within(enabledRow).getByText(ORG_MANAGER_LABELS.active),
      ).toBeTruthy();
      expect(committed).toBe(true);
      expect(failedReads).toBe(failure === "read" ? 1 : 0);
      expect(droppedEnableHint()).toBe(1);
    } finally {
      fetchSpy.mockRestore();
    }
  },
  120_000,
);

import { afterEach, expect, spyOn, test } from "bun:test";
import { act, waitFor } from "@testing-library/react";
import {
  generatePaneKeyPairFromMenu,
  getExplorerSidebarItemsByName,
  readPaneRecoveryKey,
  restorePaneFromRecoveryKey,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  createChildContainer,
  openExplorer,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import {
  listProxiedApiRequests,
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import {
  expectLifecycleRequestBoundary,
  PANE_RECONNECT_BUDGET,
  PANE_REMOTE_RECONNECT_BUDGET,
} from "../../../../test/helpers/paneLifecycleRequestBudgets";
import {
  expectCachedLifecycleNotes,
  expectNoPendingPaneWrites,
  provisionLifecyclePane,
  renderLifecyclePane,
  setLifecycleNetworkMode,
  waitForLifecycleConnection,
  waitForLifecycleNotesHydration,
} from "../../../../test/helpers/paneLifecycleRequestFixture";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  waitForPaneRuntimeToSettle,
} from "../../../../test/helpers/paneTestUtils";
import { expectProxiedApiRequestBudget } from "../../../../test/helpers/proxiedApiRequestBudget";
import { measureWorkflowRequests } from "../../../../test/helpers/workflowRequestBudget";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

for (const remoteChange of [false, true]) {
  test(`settled pane reconnect ${remoteChange ? "with a remote folder" : "with nothing pending"} has a complete request budget`, async () => {
    useTestApiAppHandlers();
    const reader = renderLifecyclePane(createTestHostConfig());
    await provisionLifecyclePane(reader);
    const writer = remoteChange
      ? renderLifecyclePane(createTestHostConfig(), "right")
      : null;
    if (writer) {
      await generatePaneKeyPairFromMenu(writer.pane);
      await restorePaneFromRecoveryKey(
        writer.pane,
        await readPaneRecoveryKey(reader.pane),
      );
      await waitForLifecycleConnection(writer.sdk);
      await openExplorer(writer.pane);
      await act(() => waitForLifecycleNotesHydration(writer.sdk));
      await expectCachedLifecycleNotes(writer.sdk);
      await waitForPaneRuntimeToSettle();
      expect(writer.sdk.database.id).not.toBe(reader.sdk.database.id);
      expect(writer.sdk.session.authToken).not.toBe(
        reader.sdk.session.authToken,
      );
      await expectNoPendingPaneWrites(writer.sdk);
    }
    await waitForPaneRuntimeToSettle();
    await expectNoPendingPaneWrites(reader.sdk);
    const generation = reader.sdk.events.connectionGeneration;
    const disconnectStart = listProxiedApiRequests().length;
    await setLifecycleNetworkMode(reader, true);
    await waitForPaneRuntimeToSettle();
    expect(listProxiedApiRequests().slice(disconnectStart)).toEqual([]);

    if (writer) {
      const createStart = listProxiedApiRequests().length;
      await createChildContainer(writer.pane, "Created during disconnect");
      await waitFor(
        () =>
          expect(
            listProxiedApiRequests()
              .slice(createStart)
              .some(
                (request) =>
                  request.method === "POST" &&
                  request.status === 200 &&
                  request.url.endsWith("/containers/with-metadata-document"),
              ),
          ).toBe(true),
        { timeout: 20_000 },
      );
      await expectNoPendingPaneWrites(writer.sdk);
      await waitForPaneRuntimeToSettle();
      expect(reader.sdk.events.connected).toBe(false);
      expect(
        getExplorerSidebarItemsByName(reader.pane, "Created during disconnect"),
      ).toEqual([]);
      expect(
        reader.sdk.deviceFirst
          .open()
          .containerStore.getSnapshot()
          .nodes.some((node) => node.name === "Created during disconnect"),
      ).toBe(false);
    }
    await expectNoPendingPaneWrites(reader.sdk);
    // The socket catch-up runs outside coordinator lanes. Observe its real
    // promise instead of treating an HTTP-quiet gap mid-crawl as settlement.
    const catchup = spyOn(
      reader.sdk.deviceFirst.open().reconciler,
      "reconcileNow",
    );
    const budget = remoteChange
      ? PANE_REMOTE_RECONNECT_BUDGET
      : PANE_RECONNECT_BUDGET;
    try {
      const requests = await measureWorkflowRequests({
        label: remoteChange
          ? "pane reconnect remote folder"
          : "pane reconnect nothing pending",
        budget,
        mutations: [],
        operation: async () => {
          await setLifecycleNetworkMode(reader, false);
          expect(reader.sdk.events.connectionGeneration).toBe(generation + 1);
          await waitFor(() => expect(catchup).toHaveBeenCalledTimes(1));
          await act(async () => {
            for (const result of catchup.mock.results) {
              expect(result.type).toBe("return");
              if (result.type === "return") await result.value;
            }
          });
          if (writer) {
            await waitFor(
              () =>
                expect(
                  getExplorerSidebarItemsByName(
                    reader.pane,
                    "Created during disconnect",
                  ),
                ).toHaveLength(1),
              { timeout: 20_000 },
            );
            const remoteFolder = writer.sdk.deviceFirst
              .open()
              .containerStore.getSnapshot()
              .nodes.find((node) => node.name === "Created during disconnect");
            expect(remoteFolder).toBeDefined();
            expect(
              reader.sdk.deviceFirst
                .open()
                .containerStore.getSnapshot()
                .nodes.find((node) => node.name === "Created during disconnect")
                ?.id,
            ).toBe(remoteFolder?.id);
          }
          await expectNoPendingPaneWrites(reader.sdk);
          await expectCachedLifecycleNotes(reader.sdk);
        },
      });
      expectLifecycleRequestBoundary(requests, budget);
      if (!remoteChange) {
        // A real extra read must trip the per-route guard even with spare total
        // capacity. This control is deliberately outside the measured reconnect.
        const extra = await measureWorkflowRequests({
          label: "negative control extra memberships read",
          budget: {
            total: 1,
            byRequest: { "GET /organization-memberships": 1 },
          },
          mutations: [],
          operation: () =>
            reader.sdk.organizations.memberships
              .refresh()
              .then(() => undefined),
        });
        expect(extra).toHaveLength(1);
        expect(() =>
          expectProxiedApiRequestBudget(
            "negative control",
            [...requests, ...extra],
            {
              ...budget,
              total: budget.total + 1,
            },
          ),
        ).toThrow("budget for GET /organization-memberships: 2 > 1");
      }
      expect(
        requests.every(
          (request) =>
            request.authorization === `Bearer ${reader.sdk.session.authToken}`,
        ),
      ).toBe(true);
    } finally {
      catchup.mockRestore();
    }
  }, 90_000);
}

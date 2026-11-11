import { expect, spyOn } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { useEffect } from "react";
import type { AppHostConfig } from "../../src/host/AppHostConfig";
import { useTearleads } from "../../src/providers/sdk/TearleadsProvider";
import { waitForAppTestRuntimeToSettle } from "./appRuntimeIdle";
import {
  interact,
  selectContainerAndWaitForItemTable,
  waitForSinglePaneProvisioning,
} from "./dual-pane/dualPaneCore";
import {
  createChildContainer,
  createNoteInContainer,
  openExplorer,
} from "./dual-pane/dualPaneExplorerKit";
import { requestPath } from "./dualPaneRequestSummary";
import { listProxiedApiRequests } from "./msw/server";
import {
  createTestHostConfig,
  renderPane,
  waitForPaneRuntimeToSettle,
} from "./paneTestUtils";
import { documentSyncIntentCounts } from "./proxiedApiRequestMetrics";
import { waitForPersonalBootstrap } from "./waitForPersonalBootstrap";

function SdkProbe({ capture }: { capture: (sdk: Tearleads) => void }) {
  const sdk = useTearleads();
  useEffect(() => capture(sdk), [capture, sdk]);
  return null;
}

export function renderLifecyclePane(
  hostConfig: AppHostConfig = createTestHostConfig({
    autoProvisionIdentity: true,
  }),
) {
  let current: Tearleads | undefined;
  const view = renderPane({
    hostConfig,
    children: (
      <SdkProbe
        capture={(sdk) => {
          current = sdk;
        }}
      />
    ),
  });
  const pane = view.container.querySelector<HTMLElement>(".pane");
  invariant(pane, "Expected lifecycle pane");
  return {
    pane,
    view,
    sdk: () => {
      invariant(current, "Expected mounted SDK");
      return current;
    },
  };
}

export async function waitForLifecycleConnection(
  sdk: Tearleads,
  generation: number,
) {
  await waitFor(() => {
    expect(sdk.events.connected).toBe(true);
    expect(sdk.events.connectionGeneration).toBe(generation);
    expect(sdk.events.pendingConnectAttempt).toBeUndefined();
  });
  await waitForPaneRuntimeToSettle();
}

export async function seedLifecycleTree(pane: HTMLElement) {
  await waitForSinglePaneProvisioning(pane);
  await waitForPersonalBootstrap();
  await openExplorer(pane);
  for (const name of ["Canary A", "Canary B"]) {
    await createChildContainer(pane, name);
    await createNoteInContainer(pane, name, `Note in ${name}`);
  }
  await selectContainerAndWaitForItemTable(pane, "/");
  await waitForPaneRuntimeToSettle();
}

export async function expectLifecycleNotes(pane: HTMLElement) {
  for (const name of ["Canary A", "Canary B"]) {
    const table = await selectContainerAndWaitForItemTable(pane, name);
    await within(table).findByRole(
      "button",
      { name: `Note in ${name}` },
      { timeout: 20_000 },
    );
  }
  await selectContainerAndWaitForItemTable(pane, "/");
}

/** Observe, never invoke, the full sweep started by the socket's real ack. */
export function observeReconnectSweep(sdk: Tearleads) {
  const sweep = spyOn(sdk.deviceFirst.open().reconciler, "reconcileNow");
  return {
    [Symbol.dispose]: () => sweep.mockRestore(),
    wait: async () => {
      await waitFor(() => expect(sweep).toHaveBeenCalledTimes(1));
      const result = sweep.mock.results[0];
      invariant(
        result?.type === "return",
        "Expected a reconnect sweep promise",
      );
      await act(async () => {
        await result.value;
      });
      await waitForPaneRuntimeToSettle();
    },
  };
}

export async function setLifecycleNetworkMode(
  pane: HTMLElement,
  offline: boolean,
) {
  await interact(() => {
    fireEvent.contextMenu(
      within(pane).getByRole("region", { name: "System status" }),
      {
        clientX: 30,
        clientY: 30,
      },
    );
  });
  await interact(() => {
    fireEvent.click(
      within(document.body).getByRole("button", {
        name: offline ? "Force Offline" : "Use Automatic Network",
      }),
    );
  });
}

export function expectLifecycleReads(
  requests: ReturnType<typeof listProxiedApiRequests>,
) {
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((request) => request.status === 200)).toBe(true);
  expect(documentSyncIntentCounts(requests).writeBearing).toBe(0);
  // No replayed intents, registration, login or provisioning may hide in a
  // reconnect/restart slice. A ticket is transport setup, not a data mutation.
  expect(
    requests.filter(
      (request) =>
        request.method !== "GET" &&
        ![
          /^\/auth\/ws-ticket$/u,
          /^\/containers\/(parent-lanes|documents)\/query$/u,
          /^\/documents\/[^/]+\/sync$/u,
        ].some(
          (pattern) =>
            request.method === "POST" && pattern.test(requestPath(request.url)),
        ),
    ),
  ).toEqual([]);
}

/** Detect a measurement that stopped before delayed follow-up work began. */
export async function expectNoLateLifecycleRequests() {
  const count = listProxiedApiRequests().length;
  await act(async () => {
    // Span the 250ms system-container bootstrap poll, as the other pane canaries do.
    expect(
      await waitForAppTestRuntimeToSettle({
        apiQuietMs: 500,
        timeoutMs: 20_000,
      }),
    ).toBe(true);
  });
  expect(listProxiedApiRequests()).toHaveLength(count);
}

export async function unmountLifecyclePane(
  fixture: ReturnType<typeof renderLifecyclePane>,
) {
  fixture.view.unmount();
  // Let the real provider's deferred disposal run before another runtime opens.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(fixture.sdk().events.connected).toBe(false);
  await waitForPaneRuntimeToSettle();
}

import { expect, spyOn } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { isDocumentSyncResponse } from "@tearleads/validators/response";
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
  editSelectedNoteText,
  openExplorer,
  selectExplorerNoteByName,
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
  options: Pick<
    Parameters<typeof renderPane>[0] & {},
    "legalTermsAgreement"
  > = {},
) {
  let current: Tearleads | undefined;
  const view = renderPane({
    ...options,
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

/**
 * Waits for the tree crawl an acknowledged connection starts. Its second lane
 * query follows local work the runtime-settle helper cannot see, so a
 * measurement that ended between the two queries would miss the second.
 */
export async function waitForLifecycleTreeCrawl(sdk: Tearleads) {
  await waitFor(
    () =>
      expect(
        sdk.deviceFirst.open().containerStore.getSnapshot().hydrating,
      ).toBeUndefined(),
    { timeout: 20_000 },
  );
}

/**
 * Two folders with `notesPerFolder` notes each. The first note of a folder is
 * `Note in <folder>`; the canaries that vary the account's size add more
 * notes, or `extraFolders` more folders of one note each.
 */
export async function seedLifecycleTree(
  pane: HTMLElement,
  notesPerFolder = 1,
  extraFolders = 0,
) {
  await waitForSinglePaneProvisioning(pane);
  await waitForPersonalBootstrap();
  await openExplorer(pane);
  for (const name of ["Canary A", "Canary B"]) {
    await createChildContainer(pane, name);
    await createNoteInContainer(pane, name, `Note in ${name}`);
    for (let note = 2; note <= notesPerFolder; note += 1) {
      await createNoteInContainer(pane, name, `Note ${note} in ${name}`);
    }
  }
  for (let folder = 1; folder <= extraFolders; folder += 1) {
    const name = `Canary extra ${folder}`;
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

/**
 * Observe, never invoke, the catch-up listing the SDK starts when the
 * socket's real acknowledgement advances the connection generation.
 */
export function observeReconnectSweep(sdk: Tearleads) {
  const sweep = spyOn(
    sdk.deviceFirst.open().reconciler,
    "reconcileAcknowledgedConnection",
  );
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

/** How many settle passes `waitForLifecycleQuiet` allows before it fails. */
const LIFECYCLE_QUIET_PASSES = 20;

/**
 * Waits until the runtime is settled and no request has completed for the
 * span `expectNoLateLifecycleRequests` checks, however long delayed follow-up
 * work takes to start. For a step whose requests are not measured.
 */
export async function waitForLifecycleQuiet() {
  const start = listProxiedApiRequests().length;
  for (let pass = 0; pass < LIFECYCLE_QUIET_PASSES; pass += 1) {
    const count = listProxiedApiRequests().length;
    await act(async () => {
      expect(
        await waitForAppTestRuntimeToSettle({
          apiQuietMs: 500,
          timeoutMs: 20_000,
        }),
      ).toBe(true);
    });
    if (listProxiedApiRequests().length === count) return;
  }
  // Name what kept arriving, so a failure is not a bare test timeout.
  expect(
    listProxiedApiRequests()
      .slice(start)
      .map((request) => `${request.method} ${requestPath(request.url)}`),
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
  // Name what arrived late, so a failure says which work was still pending.
  expect(
    listProxiedApiRequests()
      .slice(count)
      .map((request) => `${request.method} ${requestPath(request.url)}`),
  ).toEqual([]);
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

/** The document syncs `sdk`'s session completed since request `start`. */
export function lifecycleSyncRequestsBy(sdk: Tearleads, start: number) {
  return listProxiedApiRequests()
    .slice(start)
    .filter(
      (request) =>
        request.method === "POST" &&
        request.status === 200 &&
        request.authorization === `Bearer ${sdk.session.authToken}` &&
        /^\/documents\/[^/]+\/sync$/u.test(requestPath(request.url)),
    );
}

/**
 * Rewrites the first note of the first seeded folder as `text`, and waits
 * until the server accepted the edit and the runtime settled.
 */
export async function editLifecycleNote(
  pane: HTMLElement,
  sdk: Tearleads,
  text: string,
) {
  const folder = "Canary A";
  await selectContainerAndWaitForItemTable(pane, folder);
  await selectExplorerNoteByName(pane, `Note in ${folder}`);
  const start = listProxiedApiRequests().length;
  await editSelectedNoteText(pane, text);
  await waitFor(() => {
    expect(
      lifecycleSyncRequestsBy(sdk, start).some((request) => {
        const response: unknown = JSON.parse(request.responseBody);
        return (
          isDocumentSyncResponse(response) &&
          response.acceptedOutgoingUpdateIds.length > 0
        );
      }),
    ).toBe(true);
  });
  await waitForPaneRuntimeToSettle();
}

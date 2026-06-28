import { afterEach, expect, test } from "bun:test";
import { act, cleanup } from "@testing-library/react";
import { waitForAppTestRuntimeToSettle } from "../../../../test/helpers/appRuntimeIdle";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getPaneRoot,
  renderSinglePane,
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
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

const CONTAINER_WRITER_PROJECTION_PATTERN =
  /^\/containers\/[^/]+\/writer-projection$/u;

function countContainerWriterProjectionGets(
  requests: readonly { method: string; url: string }[],
): number {
  return requests.filter(
    (request) =>
      request.method === "GET" &&
      CONTAINER_WRITER_PROJECTION_PATTERN.test(requestPath(request.url)),
  ).length;
}

async function settle(): Promise<void> {
  await act(async () => {
    await waitForAppTestRuntimeToSettle({ apiQuietMs: 200, timeoutMs: 15_000 });
  });
}

// Creating a container authors its writer projection locally, and the create
// path now primes it (ApiClient.primeContainerWriterProjection from
// createWithMetadata). So the first write under a just-created container must
// reuse that primed projection instead of issuing a cold
// GET /containers/:id/writer-projection — which is what it did before.
test(
  "writing into a just-created container reuses its primed writer projection",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane();
    const pane = getPaneRoot(view, "left");

    await waitForSinglePaneProvisioning(pane);
    await settle();
    await openExplorer(pane);
    await settle();

    await createChildContainer(pane, "PrimedSub");
    await settle();

    const beforeNote = listProxiedApiRequests().length;
    await createNoteInContainer(pane, "PrimedSub", "Primed note");
    await settle();

    const noteWindow = listProxiedApiRequests().slice(beforeNote);
    const containerProjectionGets =
      countContainerWriterProjectionGets(noteWindow);
    expect(
      containerProjectionGets,
      "Creating a note in a just-created container should reuse the primed " +
        `container writer projection, but it issued ${containerProjectionGets} ` +
        `GET(s).\nrequests=\n${summarizeProxiedApiRequests(noteWindow)}`,
    ).toBe(0);
    // Sanity: the note was actually created, so the 0 GETs reflects real reuse
    // rather than a skipped write.
    expect(
      noteWindow.some(
        (request) =>
          request.method === "POST" &&
          requestPath(request.url) === "/documents",
      ),
    ).toBe(true);
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

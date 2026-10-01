import { afterEach, expect, test } from "bun:test";
import { act, cleanup } from "@testing-library/react";
import { waitForAppTestRuntimeToSettle } from "../../../../test/helpers/appRuntimeIdle";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getPaneRoot,
  renderSinglePane,
  selectContainerAndWaitForItemTable,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  createChildContainer,
  createNoteInContainer,
  openExplorer,
  openExplorerContainerInfo,
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
const ORGANIZATION_READ_MODEL_PATTERN = /^\/organizations\/[^/]+\/read-model$/u;
const CONTAINER_DOCUMENT_FANOUT_PATTERNS = [
  { method: "GET", pattern: /^\/containers$/u },
  { method: "GET", pattern: /^\/containers\/[^/]+\/documents$/u },
  { method: "POST", pattern: /^\/documents\/[^/]+\/sync$/u },
] as const;

function countContainerWriterProjectionGets(
  requests: readonly { method: string; url: string }[],
): number {
  return requests.filter(
    (request) =>
      request.method === "GET" &&
      CONTAINER_WRITER_PROJECTION_PATTERN.test(requestPath(request.url)),
  ).length;
}

function countMatchingRequests(
  requests: readonly { method: string; url: string }[],
  method: string,
  pattern: RegExp,
): number {
  return requests.filter(
    (request) =>
      request.method === method && pattern.test(requestPath(request.url)),
  ).length;
}

function listContainerDocumentFanoutRequests(
  requests: ReturnType<typeof listProxiedApiRequests>,
) {
  return requests.filter((request) =>
    CONTAINER_DOCUMENT_FANOUT_PATTERNS.some(
      ({ method, pattern }) =>
        request.method === method && pattern.test(requestPath(request.url)),
    ),
  );
}

function expectContainerInfoRequestBoundary(
  label: string,
  requests: ReturnType<typeof listProxiedApiRequests>,
  expectedReadModelRequestCount: number,
): void {
  const requestSummary = summarizeProxiedApiRequests(requests);
  expect(
    countMatchingRequests(requests, "GET", ORGANIZATION_READ_MODEL_PATTERN),
    `${label} should perform ${expectedReadModelRequestCount} detail-scoped organization feed reconciles.\nrequests=\n${requestSummary}`,
  ).toBe(expectedReadModelRequestCount);
  expect(
    countContainerWriterProjectionGets(requests),
    `${label} should reuse Explorer's cached container writer projection.\nrequests=\n${requestSummary}`,
  ).toBe(0);
  expect(
    listContainerDocumentFanoutRequests(requests),
    `${label} must not trigger container listing, document listing, or document sync fanout.\nrequests=\n${requestSummary}`,
  ).toEqual([]);
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

test(
  "container info catches up once and keeps warm remounts local",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane();
    const pane = getPaneRoot(view, "left");

    await waitForSinglePaneProvisioning(pane);
    await settle();
    await openExplorer(pane);
    await settle();

    const coldRequestStartIndex = listProxiedApiRequests().length;
    await openExplorerContainerInfo(pane, "/");
    await settle();

    const coldRequests = listProxiedApiRequests().slice(coldRequestStartIndex);
    expectContainerInfoRequestBoundary(
      "Cold container-info mount",
      coldRequests,
      1,
    );

    await selectContainerAndWaitForItemTable(pane, "/");
    await settle();
    const remountRequestStartIndex = listProxiedApiRequests().length;

    await openExplorerContainerInfo(pane, "/");
    await settle();

    const remountRequests = listProxiedApiRequests().slice(
      remountRequestStartIndex,
    );
    expectContainerInfoRequestBoundary(
      "Warm container-info remount",
      remountRequests,
      0,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);

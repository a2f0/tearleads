import { afterEach, expect, spyOn, test } from "bun:test";
import {
  createDomainScope,
  type DomainScope,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useSyncLaneHolds } from "./useSyncLaneHolds";

const scopes: DomainScope[] = [];

afterEach(() => {
  cleanup();
  for (const scope of scopes.splice(0))
    getOrCreateDomainSyncCoordinator(scope).dispose();
});

function createScope(): DomainScope {
  const scope = createDomainScope();
  scopes.push(scope);
  return scope;
}

const NO_PAUSES: ReadonlySet<string> = new Set();

function renderHolds(domainScope: DomainScope) {
  return renderHook(
    ({ online }: { online: boolean }) =>
      useSyncLaneHolds({
        activityDelays: { enterMs: 20, exitMs: 20 },
        dbReady: true,
        domainScope,
        online,
        pausedOrganizationIds: NO_PAUSES,
        writeOrganizationIds: [],
      }),
    { initialProps: { online: true } },
  );
}

test("a running lane shows as held activity and a failing one as a failure", async () => {
  const domainScope = createScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const holds = renderHolds(domainScope);

  const { promise: running, resolve: finish } = Promise.withResolvers<void>();
  coordinator
    .registerLane("documents:slow", { run: () => running })
    .requestSync();
  await waitFor(() => expect(holds.result.current.lanes.running).toBe(1));
  await waitFor(() => expect(holds.result.current.syncActive).toBe(true));

  // The coordinator logs each failed run; the test expects that line.
  const consoleError = spyOn(console, "error").mockImplementation(() => {});
  coordinator
    .registerLane("documents:broken", {
      run: async () => {
        throw new Error("Sync failed (500)");
      },
    })
    .requestSync();
  await waitFor(() =>
    expect(holds.result.current.lanes).toEqual({
      failed: 1,
      firstError: "Sync failed (500)",
      running: 1,
    }),
  );
  expect(String(consoleError.mock.calls[0]?.[0])).toContain("documents:broken");
  consoleError.mockRestore();

  // Offline, the same lanes are neither activity nor failures.
  holds.rerender({ online: false });
  expect(holds.result.current.lanes).toEqual({
    failed: 0,
    firstError: null,
    running: 0,
  });

  await act(async () => finish());
  holds.rerender({ online: true });
  await waitFor(() => expect(holds.result.current.syncActive).toBe(false));
});

test("a publish that changes no count keeps the same lane summary", async () => {
  const domainScope = createScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const holds = renderHolds(domainScope);
  const upload = coordinator.beginUploadLane("upload:photo", {
    blobStorageKey: "blob-photo",
  });
  await waitFor(() => expect(holds.result.current.lanes.running).toBe(1));
  const before = holds.result.current.lanes;

  // Progress ticks publish a new coordinator snapshot each time.
  await act(async () => {
    for (let part = 1; part <= 3; part += 1)
      upload.reportProgress({
        bytesTotal: 300,
        bytesUploaded: part * 100,
        partsCompleted: part,
        partsTotal: 3,
      });
    await Promise.resolve();
  });
  expect(holds.result.current.lanes).toBe(before);
});

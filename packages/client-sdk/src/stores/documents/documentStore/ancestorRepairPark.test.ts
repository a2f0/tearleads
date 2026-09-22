import { expect, test } from "bun:test";
import type { DocumentsRuntime } from "../types";
import { parkForAncestorRepair } from "./ancestorRepairPark";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { createDocumentStoreState, type DocumentStoreState } from "./state";
import { handleDocumentRemoteEvents } from "./syncRemoteSignals";

const DOCUMENT_ID = "55555555-5555-4555-8555-555555555555";

function createOpenDocument() {
  const events: unknown[] = [];
  const runtime = {
    apiClient: {},
    auth: undefined,
    infra: { blobStore: {}, documentProjectors: {}, execSql: () => undefined },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: "leaf",
      domainScope: "scope-1",
      events,
      peerScope: "peer-1",
    },
  } as unknown as DocumentsRuntime;
  const state = createDocumentStoreState(
    "local-1",
    runtime,
    {} as never,
    noopDocumentStorePersistenceEffects,
    DOCUMENT_ID,
  );
  state.record = { documentId: DOCUMENT_ID } as DocumentStoreState["record"];
  return { events, state };
}

const PATH_CHANGED = {
  containerIds: ["leaf"],
  id: "event-1",
  type: "container_path_changed",
};

// The member who repairs the stale intermediate is not someone this writer
// subscribes to: the gateway's dependent-path hint is the only signal, and on
// its own it only drops caches.

test("a parked document re-runs on the next dependent-path hint, once", () => {
  const { events, state } = createOpenDocument();
  let scheduled = 0;
  const schedule = () => {
    scheduled += 1;
  };
  expect(
    parkForAncestorRepair(
      state,
      "inaccessible",
      state.writerProjectionGeneration,
    ),
  ).toBe(false);
  expect(state.awaitingAncestorRepair).toBe(true);

  events.push(PATH_CHANGED);
  handleDocumentRemoteEvents(state, schedule);
  expect(scheduled).toBe(1);
  expect(state.awaitingAncestorRepair).toBe(false);

  // The park is consumed: later hints are ordinary cache invalidations until a
  // pass parks again.
  events.push({ ...PATH_CHANGED, id: "event-2" });
  handleDocumentRemoteEvents(state, schedule);
  expect(scheduled).toBe(1);
});

test("hints never schedule a document that is not parked", () => {
  const { events, state } = createOpenDocument();
  let scheduled = 0;
  events.push(PATH_CHANGED);
  handleDocumentRemoteEvents(state, () => {
    scheduled += 1;
  });
  expect(scheduled).toBe(0);
});

test("only the inaccessible abandon parks", () => {
  const { state } = createOpenDocument();
  for (const reason of ["refused", "blocked", "peer-rotation"]) {
    expect(
      parkForAncestorRepair(state, reason, state.writerProjectionGeneration),
    ).toBe(false);
    expect(state.awaitingAncestorRepair).toBe(false);
  }
});

// The repair can land between this pass's projection fetch and its abandon. The
// hint it would park for has then already been consumed as a plain
// invalidation, so parking would wait for a signal that never comes again.

test("a hint that landed mid-pass re-runs instead of parking", () => {
  const { events, state } = createOpenDocument();
  const generationAtStart = state.writerProjectionGeneration;
  events.push(PATH_CHANGED);
  handleDocumentRemoteEvents(state, () => undefined);
  expect(state.writerProjectionGeneration).not.toBe(generationAtStart);

  expect(parkForAncestorRepair(state, "inaccessible", generationAtStart)).toBe(
    true,
  );
  expect(state.awaitingAncestorRepair).toBe(false);
});

import { expect, test } from "bun:test";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import type { DocumentsRuntime } from "../types";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { createDocumentStoreState, type DocumentStoreState } from "./state";
import { handleDocumentRemoteEvents } from "./syncRemoteSignals";
import { installDocumentWriterProjection } from "./writerProjectionGeneration";

const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";

/** An open remote document holding a writer projection in memory. */
function createOpenDocument() {
  const events: unknown[] = [];
  const runtime = {
    apiClient: {},
    auth: undefined,
    infra: { blobStore: {}, documentProjectors: {}, execSql: () => undefined },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: "container-1",
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
  const projection = {
    documentId: DOCUMENT_ID,
  } as unknown as DocumentWriterProjectionResponse;
  state.writerProjection = projection;
  return { events, projection, state };
}

test("a container hint drops the document's in-memory writer projection", () => {
  const { events, state } = createOpenDocument();
  // An ancestor of the document's containers was granted to a peer; the
  // document cannot tell which containers it links into, so it drops the
  // projection whose path may now cite a stale manifest.
  events.push({
    containerId: "ancestor",
    eventType: "container.grant",
    id: "event-1",
    parentId: null,
    type: "container_mutation_created",
  });
  handleDocumentRemoteEvents(state, () => undefined);
  expect(state.writerProjection).toBeNull();
});

test("the gateway's dependent-path hint drops it too", () => {
  const { events, state } = createOpenDocument();
  events.push({
    containerIds: ["granted"],
    id: "event-1",
    type: "container_path_changed",
  });
  handleDocumentRemoteEvents(state, () => undefined);
  expect(state.writerProjection).toBeNull();
});

test("document update hints leave the writer projection in place", () => {
  const { events, projection, state } = createOpenDocument();
  events.push({
    containerIds: ["container-1"],
    documentId: "55555555-5555-4555-8555-555555555555",
    id: "event-1",
    type: "document_update_created",
  });
  handleDocumentRemoteEvents(state, () => undefined);
  expect(state.writerProjection).toBe(projection);
});

test("a hint during an in-flight create is consumed as an invalidation even before the document has an id", () => {
  const { events, projection, state } = createOpenDocument();
  // Creation is in flight: no remote identity yet, and the create captured the
  // generation when it started.
  state.record = null;
  state.writerProjection = null;
  const capturedGeneration = state.writerProjectionGeneration;
  events.push({
    containerId: "container-1",
    eventType: "container.grant",
    id: "event-1",
    parentId: null,
    type: "container_mutation_created",
  });
  handleDocumentRemoteEvents(state, () => undefined);
  expect(state.lastEventCount).toBe(1);
  expect(state.writerProjectionGeneration).toBe(capturedGeneration + 1);

  // The create settles with the projection it was handed back.
  installDocumentWriterProjection(state, projection, capturedGeneration);
  expect(state.writerProjection).toBeNull();
});

for (const type of ["container_children_changed", "resync_required"]) {
  test(`${type} invalidates an open document projection`, () => {
    const { events, state } = createOpenDocument();
    events.push({ type, id: "refresh-1", containerIds: ["ancestor"] });
    handleDocumentRemoteEvents(state, () => undefined);
    expect(state.writerProjection).toBeNull();
  });
}

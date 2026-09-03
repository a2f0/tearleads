import { expect, test } from "bun:test";
import {
  createRestartProbeTraceRecorder,
  persistRestartProbeTrace,
  type RestartProbeTraceRecorder,
} from "@tearleads/test-utils";
import type { DocumentsRuntime } from "../types";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { createDocumentStoreState, type DocumentStoreState } from "./state";
import {
  allowDocumentStoreRemoteSync,
  markDocumentStoreRemoteSyncPending,
} from "./syncGeneration";
import {
  clearConsumedRemoteUpdateSignal,
  handleDocumentRemoteEvents,
} from "./syncRemoteSignals";

/**
 * Projects a fault-injected run of the real remote-probe signal kernels onto
 * the RestartProbeConvergence model's action vocabulary. Every probe decision
 * below — arming on a delivered hint, suppressing an author echo, retaining a
 * signal that moved mid-flight, clearing a consumed one — is made by the
 * production kernels, then recorded with the implementation-projected
 * `probeRequested` bit. scripts/checkRestartProbeProjection.ts replays the
 * recorded trace through TLC, so a sequence or a projected bit the model
 * rejects fails `check:fast`. Interest-barrier steps are scripted here (the
 * app package records those seams from its own scenario); the restart
 * re-initialization arming mirrors `initializeDocumentStore` arming
 * `remoteUpdatePending` for a loaded remote record.
 */

const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";

function createProbeState(): DocumentStoreState {
  const deliveredEvents: unknown[] = [];
  const runtime = {
    apiClient: {},
    auth: undefined,
    infra: { blobStore: {}, documentProjectors: {}, execSql: () => undefined },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: "container-1",
      domainScope: "scope-1",
      events: deliveredEvents,
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
  // The scenario starts at the model's Init: connected and settled, no
  // outstanding probe.
  state.remoteSyncBlocked = false;
  return state;
}

interface ProbeFlight {
  readonly consumedSignalSequence: number;
}

/**
 * The model's queued-probe bit, projected from the implementation: outside a
 * flight it is the pending signal; during a flight it is whether a newer
 * signal arrived after the flight captured its consumed sequence — the same
 * comparison `canClearRemoteUpdateSignalAfterSync` makes at completion.
 */
function projectedProbeRequested(
  state: DocumentStoreState,
  flight: ProbeFlight | null,
): boolean {
  return flight
    ? state.remoteUpdateSignalSeq > flight.consumedSignalSequence
    : state.remoteUpdatePending;
}

function deliverRemoteEvent(
  state: DocumentStoreState,
  updateId: string,
): boolean {
  // The fake runtime's events array is deliberately shared and mutable: the
  // real events store swaps in a fresh array per push, and the handler only
  // reads length and slices past its consumed count.
  (state.runtime.state.events as unknown[]).push({
    containerIds: ["container-1"],
    documentId: DOCUMENT_ID,
    type: "document_update_created",
    updateIds: [updateId],
  });
  let scheduled = false;
  handleDocumentRemoteEvents(state, () => {
    scheduled = true;
  });
  return scheduled;
}

function beginProbe(
  recorder: RestartProbeTraceRecorder,
  state: DocumentStoreState,
): ProbeFlight {
  const flight = { consumedSignalSequence: state.remoteUpdateSignalSeq };
  recorder.record({
    action: "BeginProbe",
    observed: { probeRequested: projectedProbeRequested(state, flight) },
  });
  return flight;
}

function finishProbe(
  recorder: RestartProbeTraceRecorder,
  state: DocumentStoreState,
  flight: ProbeFlight,
): void {
  clearConsumedRemoteUpdateSignal(state, flight.consumedSignalSequence);
  recorder.record({
    action: "FinishProbe",
    observed: { probeRequested: projectedProbeRequested(state, null) },
  });
}

test("probe signal kernels replay onto the RestartProbeConvergence model", () => {
  const recorder = createRestartProbeTraceRecorder("probe-signal-kernels");
  let state = createProbeState();

  // A delivered peer hint arms the probe through the real handler.
  expect(deliverRemoteEvent(state, "update-1")).toBe(true);
  recorder.record({
    action: "RemoteBodyAdvance",
    delivered: true,
    observed: { probeRequested: projectedProbeRequested(state, null) },
  });
  expect(state.remoteUpdatePending).toBe(true);

  // The flight captures the consumed sequence; the queued bit drains.
  let flight = beginProbe(recorder, state);

  // A second hint lands mid-flight: the kernel arms a newer sequence, which
  // projects as the model's re-queued probe (newerRequestDuringFlight).
  expect(deliverRemoteEvent(state, "update-2")).toBe(true);
  recorder.record({
    action: "RemoteSlotAdvance",
    delivered: true,
    observed: { probeRequested: projectedProbeRequested(state, flight) },
  });

  // Completion clears only the consumed sequence: the newer signal survives.
  finishProbe(recorder, state, flight);
  expect(state.remoteUpdatePending).toBe(true);

  // The coalesced re-run consumes the surviving signal and settles.
  flight = beginProbe(recorder, state);
  finishProbe(recorder, state, flight);
  expect(state.remoteUpdatePending).toBe(false);

  // An author echo (every update id locally accepted) must not arm a probe —
  // and therefore records no model action at all.
  state.locallyAcceptedUpdateIds.add("update-3");
  expect(deliverRemoteEvent(state, "update-3")).toBe(false);
  expect(state.remoteUpdatePending).toBe(false);

  // Restart destroys process-local probe state; the persisted row survives.
  recorder.record({ action: "Restart" });
  state = createProbeState();

  // Re-initialization arms the startup probe for the loaded remote record.
  allowDocumentStoreRemoteSync(state);
  markDocumentStoreRemoteSyncPending(state, "independent");
  recorder.record({
    action: "InitializeOpenedPersistedDocument",
    observed: { probeRequested: projectedProbeRequested(state, null) },
  });

  // The startup probe may run before the interest barrier completes.
  flight = beginProbe(recorder, state);
  finishProbe(recorder, state, flight);
  expect(state.remoteUpdatePending).toBe(false);

  // Scripted interest recovery: the app package records these seams from its
  // own scenario; here they sequence the barrier the model requires.
  recorder.record({ action: "ReceiveInterestBaseline" });
  recorder.record({ action: "MarkContainerTreeReady" });
  recorder.record({ action: "DeclareKnownContainers" });

  // The matching ack requests revalidation. The arming call below mirrors
  // the production reconnect wiring; the kernels then own the signal.
  allowDocumentStoreRemoteSync(state);
  markDocumentStoreRemoteSyncPending(state, "independent");
  recorder.record({
    action: "AcknowledgeKnownContainers",
    observed: { probeRequested: projectedProbeRequested(state, null) },
  });

  flight = beginProbe(recorder, state);
  finishProbe(recorder, state, flight);
  expect(state.remoteUpdatePending).toBe(false);

  const trace = recorder.trace();
  expect(trace.steps.map((step) => step.action)).toEqual([
    "RemoteBodyAdvance",
    "BeginProbe",
    "RemoteSlotAdvance",
    "FinishProbe",
    "BeginProbe",
    "FinishProbe",
    "Restart",
    "InitializeOpenedPersistedDocument",
    "BeginProbe",
    "FinishProbe",
    "ReceiveInterestBaseline",
    "MarkContainerTreeReady",
    "DeclareKnownContainers",
    "AcknowledgeKnownContainers",
    "BeginProbe",
    "FinishProbe",
  ]);
  persistRestartProbeTrace(trace);
});

import { expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import {
  createRestartProbeTraceRecorder,
  persistRestartProbeTrace,
  type RestartProbeTraceRecorder,
} from "@tearleads/test-utils";
import {
  serializeWsServerMessage,
  type WsInvalidationHint,
} from "@tearleads/validators/realtime";
import { startContainerInterestDeclaration } from "./containerInterest";
import { routeIncomingWsMessage } from "./serverEventsRouting";

/**
 * Projects a fault-injected run of the real interest-barrier seams onto the
 * RestartProbeConvergence model's action vocabulary. The imports stay on the
 * leaf modules so the scenario runs without built package output (the
 * client-sdk import is type-only). The declaration ordering
 * below is decided by the production machinery: `routeIncomingWsMessage`
 * parses the frames, `startContainerInterestDeclaration` decides when the
 * authoritative declaration is sent and which acknowledgement matches. The
 * recorded trace is replayed through TLC by
 * scripts/checkRestartProbeProjection.ts, so an ordering the model rejects —
 * a declaration before the interest baseline, an acknowledgement without a
 * declaration — fails `check:fast`. Probe-side actions are recorded by the
 * client-sdk scenario that owns those kernels.
 */

const CONTAINER_ID = "55555555-5555-4555-8555-555555555555";

function createFakeContainerStore() {
  const listeners = new Set<() => void>();
  return {
    store: {
      getSnapshot: () => ({ nodes: [{ id: CONTAINER_ID }], ready: true }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

function createFakeSocket(recorder: RestartProbeTraceRecorder | null) {
  const sent: string[] = [];
  return {
    sent,
    ws: {
      readyState: WebSocket.OPEN,
      send: (message: string) => {
        sent.push(message);
        // The declaration action is recorded at the moment the real interest
        // machine emits the frame, so its ordering comes from the seam.
        const parsed = JSON.parse(message) as { type?: unknown };
        if (recorder && parsed.type === "known_containers") {
          recorder.record({ action: "DeclareKnownContainers" });
        }
      },
    } as unknown as WebSocket,
  };
}

interface InterestHarness {
  readonly acknowledged: string[];
  readonly hints: WsInvalidationHint[];
  readonly route: (rawFrame: string) => void;
  readonly sent: string[];
  readonly stop: () => void;
}

function startInterestHarness(
  baseline: readonly string[],
  recorder: RestartProbeTraceRecorder | null,
): InterestHarness {
  const { sent, ws } = createFakeSocket(recorder);
  const tearleads = {
    deviceFirst: {
      open: () => ({ containerStore: createFakeContainerStore().store }),
    },
  } as unknown as Tearleads;
  const acknowledged: string[] = [];
  const hints: WsInvalidationHint[] = [];
  let handle: ReturnType<typeof startContainerInterestDeclaration> | null =
    null;

  const route = (rawFrame: string): void => {
    routeIncomingWsMessage(rawFrame, {
      onContainerInterestAcknowledged: (declarationId) => {
        if (handle?.acknowledge(declarationId)) {
          acknowledged.push(declarationId);
        }
      },
      onInterestState: (interestBaseline) => {
        // The baseline action is recorded inside the routing handler, before
        // the declaration machine reacts, so the two orderings are observed
        // rather than authored.
        recorder?.record({ action: "ReceiveInterestBaseline" });
        handle?.stop();
        handle = startContainerInterestDeclaration(
          tearleads,
          ws,
          new Set(interestBaseline),
        );
      },
      onOrganizationInterestAcknowledged: () => undefined,
      onOrganizationReadModelChanged: () => undefined,
      onResyncRequired: () => undefined,
      onServerEvent: (event) => {
        hints.push(event);
      },
      onSharedWithYou: () => undefined,
    });
  };

  route(
    serializeWsServerMessage({
      containerIds: [...baseline],
      type: "interest_state",
    }),
  );

  return {
    acknowledged,
    hints,
    route,
    sent,
    stop: () => handle?.stop(),
  };
}

function sentDeclarationId(sent: readonly string[]): string {
  const declaration = JSON.parse(sent.at(-1) ?? "null") as {
    declarationId?: unknown;
    type?: unknown;
  };
  expect(declaration.type).toBe("known_containers");
  expect(typeof declaration.declarationId).toBe("string");
  return String(declaration.declarationId);
}

function acknowledgeFrame(declarationId: string): string {
  return serializeWsServerMessage({
    declarationId,
    type: "known_containers_ack",
  });
}

test("interest barrier seams replay onto the RestartProbeConvergence model", () => {
  const recorder = createRestartProbeTraceRecorder("interest-barrier-seams");

  // Pre-trace settle to the model's Init: connected, declared, acknowledged.
  let harness = startInterestHarness([CONTAINER_ID], null);
  harness.route(acknowledgeFrame(sentDeclarationId(harness.sent)));
  expect(harness.acknowledged).toHaveLength(1);

  // The events socket drops; accepted work is retained.
  harness.stop();
  recorder.record({ action: "DisconnectEvents" });

  // A peer commits while disconnected: no hint can be delivered.
  recorder.record({ action: "RemoteBodyAdvance", delivered: false });

  // Reconnect: the server's interest baseline restores protocol context, and
  // the real declaration machine — seeing a ready container tree — sends the
  // authoritative declaration immediately. Both actions are recorded at their
  // seams (the routing handler and the observed frame), so the ordering the
  // model checks is the implementation's own.
  harness = startInterestHarness([CONTAINER_ID], recorder);
  expect(harness.sent).toHaveLength(1);
  const declarationId = sentDeclarationId(harness.sent);

  // An acknowledgement from an older connection must not cross this
  // declaration: the real machine refuses it, so no model action is recorded.
  harness.route(acknowledgeFrame("stale-declaration-id"));
  expect(harness.acknowledged).toHaveLength(0);

  // The matching acknowledgement is the ordering barrier.
  harness.route(acknowledgeFrame(declarationId));
  expect(harness.acknowledged).toEqual([declarationId]);
  recorder.record({ action: "AcknowledgeKnownContainers" });

  // With interest ready, a delivered hint reaches the events store.
  harness.route(
    serializeWsServerMessage({
      containerIds: [CONTAINER_ID],
      documentId: "66666666-6666-4666-8666-666666666666",
      type: "document_update_created",
      updateIds: ["update-1"],
    }),
  );
  expect(harness.hints).toHaveLength(1);
  recorder.record({ action: "RemoteBodyAdvance", delivered: true });

  const trace = recorder.trace();
  expect(trace.steps.map((step) => step.action)).toEqual([
    "DisconnectEvents",
    "RemoteBodyAdvance",
    "ReceiveInterestBaseline",
    "DeclareKnownContainers",
    "AcknowledgeKnownContainers",
    "RemoteBodyAdvance",
  ]);
  persistRestartProbeTrace(trace);
});

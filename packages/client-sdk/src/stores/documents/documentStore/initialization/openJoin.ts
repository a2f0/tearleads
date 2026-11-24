import type { DocumentStoreJoiningOpen } from "../../types";
import type { DocumentStoreState } from "../state";
import { joinDocumentStoreStartupProbe } from "../sync/startupProbeDeferral";
import { joinDocumentStoreCreation } from "./initialContent";

/**
 * How a registered store takes in a later open of it, so whichever opener
 * came first cannot narrow the store for every later view:
 * - an open that may create lets a record still missing after a reading open
 *   be created, from this open's initial content;
 * - an open in the default startup mode gives the store the startup probe an
 *   on-demand opener skipped. An open can run during a render, so that join
 *   waits until the open returns and never publishes to subscribers inside it.
 */
export function joinBackingDocumentStoreOpen(
  input: {
    scheduleSync: () => void;
    state: DocumentStoreState;
    withLiveSyncLane: <Result>(request: () => Result) => Result;
  },
  open: DocumentStoreJoiningOpen,
): void {
  joinDocumentStoreCreation(input.state, open);
  if ((open.options.remoteSyncMode ?? "startup") !== "startup") {
    return;
  }
  queueMicrotask(() =>
    input.withLiveSyncLane(() =>
      joinDocumentStoreStartupProbe(input.state, input.scheduleSync),
    ),
  );
}

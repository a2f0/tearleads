import type { DomainSyncSnapshot } from "@tearleads/client-sdk";
import { useState } from "react";
import {
  initialLaneReconnectState,
  transitionLaneReconnect,
} from "./laneReconnectMachine";
import type { LaneFailureMarks } from "./syncActivityModel";

const NONE: LaneFailureMarks = new Map();

/**
 * The lane failures recorded before the device last came back online (see
 * `laneReconnectMachine`). The transition runs during render, so the render
 * that first sees the device online already leaves them out, with no frame of
 * warning in between.
 */
export function useStaleLaneFailures(
  online: boolean,
  snapshot: DomainSyncSnapshot,
): LaneFailureMarks {
  const [state, setState] = useState(() => initialLaneReconnectState(online));
  const next = transitionLaneReconnect(state, {
    online,
    snapshot,
    type: "observed",
  });
  if (next !== state) setState(next);
  return next.status === "online" ? next.staleFailures : NONE;
}

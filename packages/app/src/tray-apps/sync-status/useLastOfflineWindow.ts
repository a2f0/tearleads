import type { DomainSyncSnapshot } from "@tearleads/client-sdk";
import { useState } from "react";
import {
  initialLaneReconnectState,
  transitionLaneReconnect,
} from "./laneReconnectMachine";
import type { OfflineWindow } from "./syncActivityModel";

/**
 * When the device was last offline, for leaving out the failures recorded
 * then while a retry revisits them (see `laneReconnectMachine`). The
 * transition runs during render, so the render that first sees the device
 * online already has the window, with no frame of warning in between. Null
 * while offline, where every failure is hidden anyway, and before any offline
 * spell. The window outlives a change of domain scope on purpose: a scope
 * opened while offline fails inside it like the one before, and a scope
 * opened after the reconnect fails after it.
 */
export function useLastOfflineWindow(
  online: boolean,
  snapshot: DomainSyncSnapshot,
): OfflineWindow | null {
  const [state, setState] = useState(() =>
    initialLaneReconnectState(online, snapshot),
  );
  const next = transitionLaneReconnect(state, {
    online,
    snapshot,
    type: "observed",
  });
  if (next !== state) setState(next);
  return next.status === "online" ? next.offlineWindow : null;
}

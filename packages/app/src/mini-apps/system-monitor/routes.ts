export type SystemMonitorTabId = "logs" | "status";

export const DEFAULT_SYSTEM_MONITOR_TAB: SystemMonitorTabId = "logs";

export function parseSystemMonitorRouteSegments(
  pathSegments: ReadonlyArray<string>,
): SystemMonitorTabId {
  const [firstSegment] = pathSegments;
  return firstSegment === "status" || firstSegment === "logs"
    ? firstSegment
    : DEFAULT_SYSTEM_MONITOR_TAB;
}

export function formatSystemMonitorRouteSegments(
  tab: SystemMonitorTabId,
): ReadonlyArray<string> {
  return [tab];
}

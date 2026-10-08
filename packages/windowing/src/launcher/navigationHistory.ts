export interface NavigationHistoryCursor {
  entries: number;
  index: number;
}

export interface NavigationHistoryAvailability {
  canGoBack: boolean;
  canGoForward: boolean;
}

export const DEFAULT_NAVIGATION_HISTORY_CURSOR = {
  entries: 1,
  index: 0,
} satisfies NavigationHistoryCursor;

const NAVIGATION_HISTORY_STATE_KEY = "__tearleadsAppNavigation";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidHistoryCursor(
  value: unknown,
): value is NavigationHistoryCursor {
  if (!isRecord(value)) {
    return false;
  }

  const { entries, index } = value;
  return (
    Number.isInteger(entries) &&
    Number.isInteger(index) &&
    typeof entries === "number" &&
    typeof index === "number" &&
    entries > 0 &&
    index >= 0 &&
    index < entries
  );
}

export function getNavigationHistoryAvailability({
  entries,
  index,
}: NavigationHistoryCursor): NavigationHistoryAvailability {
  return {
    canGoBack: index > 0,
    canGoForward: index < entries - 1,
  };
}

export function readNavigationHistoryCursor(
  state: unknown,
): NavigationHistoryCursor | null {
  if (!isRecord(state)) {
    return null;
  }

  const cursor = state[NAVIGATION_HISTORY_STATE_KEY];
  return isValidHistoryCursor(cursor) ? cursor : null;
}

export function createNavigationHistoryState(
  currentState: unknown,
  cursor: NavigationHistoryCursor,
): Record<string, unknown> {
  return {
    ...(isRecord(currentState) ? currentState : {}),
    [NAVIGATION_HISTORY_STATE_KEY]: cursor,
  };
}

export function getNextNavigationHistoryCursor({
  index,
}: NavigationHistoryCursor): NavigationHistoryCursor {
  const nextIndex = index + 1;
  return {
    entries: nextIndex + 1,
    index: nextIndex,
  };
}

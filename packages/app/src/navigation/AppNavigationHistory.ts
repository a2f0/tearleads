export interface AppNavigationHistoryCursor {
  entries: number;
  index: number;
}

export interface AppNavigationHistoryAvailability {
  canGoBack: boolean;
  canGoForward: boolean;
}

export const DEFAULT_APP_NAVIGATION_HISTORY_CURSOR = {
  entries: 1,
  index: 0,
} satisfies AppNavigationHistoryCursor;

const APP_NAVIGATION_HISTORY_STATE_KEY = "__tearleadsAppNavigation";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidHistoryCursor(
  value: unknown,
): value is AppNavigationHistoryCursor {
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

export function getAppNavigationHistoryAvailability({
  entries,
  index,
}: AppNavigationHistoryCursor): AppNavigationHistoryAvailability {
  return {
    canGoBack: index > 0,
    canGoForward: index < entries - 1,
  };
}

export function readAppNavigationHistoryCursor(
  state: unknown,
): AppNavigationHistoryCursor | null {
  if (!isRecord(state)) {
    return null;
  }

  const cursor = state[APP_NAVIGATION_HISTORY_STATE_KEY];
  return isValidHistoryCursor(cursor) ? cursor : null;
}

export function createAppNavigationHistoryState(
  currentState: unknown,
  cursor: AppNavigationHistoryCursor,
): Record<string, unknown> {
  return {
    ...(isRecord(currentState) ? currentState : {}),
    [APP_NAVIGATION_HISTORY_STATE_KEY]: cursor,
  };
}

export function getNextAppNavigationHistoryCursor({
  index,
}: AppNavigationHistoryCursor): AppNavigationHistoryCursor {
  const nextIndex = index + 1;
  return {
    entries: nextIndex + 1,
    index: nextIndex,
  };
}

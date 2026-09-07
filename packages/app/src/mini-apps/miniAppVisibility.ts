import type { MiniAppId } from "./types";

/** Mini-apps offered only to sessions the server reported as root. */
const ROOT_ONLY_MINI_APP_IDS: ReadonlySet<MiniAppId> = new Set<MiniAppId>([
  "root",
]);

interface MiniAppVisibilityContext {
  /**
   * The session's server-reported root flag. This only decides which entries
   * the launcher and navigation offer; the API enforces root access itself,
   * so a hidden entry is a courtesy rather than a boundary.
   */
  readonly isRoot: boolean;
}

export function isMiniAppVisible(
  appId: MiniAppId,
  context: MiniAppVisibilityContext,
): boolean {
  return !ROOT_ONLY_MINI_APP_IDS.has(appId) || context.isRoot;
}

export function filterVisibleMiniAppItems<Item extends { appId: MiniAppId }>(
  items: ReadonlyArray<Item>,
  context: MiniAppVisibilityContext,
): ReadonlyArray<Item> {
  return items.filter((item) => isMiniAppVisible(item.appId, context));
}

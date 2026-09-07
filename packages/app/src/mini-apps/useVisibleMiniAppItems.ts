import { useMemo } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { filterVisibleMiniAppItems } from "./miniAppVisibility";
import type { MiniAppId } from "./types";

/**
 * The launcher entries the current session may see. Root-only entries appear
 * once the server has reported the session as root; the API still enforces
 * root access on every request, so this is presentation, not authorization.
 */
export function useVisibleMiniAppItems<Item extends { appId: MiniAppId }>(
  items: ReadonlyArray<Item>,
): ReadonlyArray<Item> {
  const { isRoot } = useCryptoSession();
  return useMemo(
    () => filterVisibleMiniAppItems(items, { isRoot }),
    [isRoot, items],
  );
}

import { useCallback, useState } from 'react';

export interface UseCombinedRefreshResult {
  /**
   * Combined refresh token (external + internal).
   * Pass this to child components that should refresh on either trigger.
   */
  combinedRefreshToken: number;

  /**
   * Increment the internal refresh token.
   * Call this after internal mutations (drag-drop, paste, create, delete).
   */
  triggerRefresh: () => void;
}

/**
 * Hook for components that need to combine external and internal refresh tokens.
 *
 * Use this when a component:
 * 1. Receives an external refreshToken prop from a parent window
 * 2. Also has internal mutations that should trigger refreshes
 *
 * The combined token changes when either source triggers a refresh,
 * allowing child components to respond to both external and internal changes.
 *
 * @example
 * ```tsx
 * function VfsExplorer({ refreshToken: externalToken }: Props) {
 *   const { combinedRefreshToken, triggerRefresh } = useCombinedRefresh(externalToken);
 *
 *   const handleDragEnd = useCallback(async (event: DragEndEvent) => {
 *     await moveItem(itemId, targetFolderId);
 *     triggerRefresh(); // Internal mutation
 *   }, [moveItem, triggerRefresh]);
 *
 *   return (
 *     <>
 *       <TreePanel refreshToken={combinedRefreshToken} />
 *       <DetailsPanel refreshToken={combinedRefreshToken} />
 *     </>
 *   );
 * }
 * ```
 */
export function useCombinedRefresh(
  externalRefreshToken?: number
): UseCombinedRefreshResult {
  const [internalRefreshToken, setInternalRefreshToken] = useState(0);

  const triggerRefresh = useCallback(() => {
    setInternalRefreshToken((prev) => prev + 1);
  }, []);

  const combinedRefreshToken =
    (externalRefreshToken ?? 0) + internalRefreshToken;

  return { combinedRefreshToken, triggerRefresh };
}

import { useEffect, useRef } from 'react';

/**
 * Hook to trigger a refetch when refreshToken changes.
 *
 * This standardizes the refresh-on-token-change pattern used by collection
 * sidebars (playlists, albums, groups, folders) to re-query data when
 * mutations occur elsewhere in the window.
 *
 * Features:
 * - Avoids refetching on initial render (only refetches when token changes)
 * - Handles undefined refreshToken gracefully
 * - Uses a ref to track previous token value
 *
 * @example
 * ```tsx
 * function PlaylistsSidebar({ refreshToken }: { refreshToken?: number }) {
 *   const { playlists, refetch } = usePlaylists();
 *
 *   useSidebarRefetch(refreshToken, refetch);
 *
 *   return <div>...</div>;
 * }
 * ```
 */
export function useSidebarRefetch(
  refreshToken: number | undefined,
  refetch: () => void | Promise<void>
): void {
  const lastTokenRef = useRef<number | null>(null);

  useEffect(() => {
    if (refreshToken === undefined) return;

    // Only refetch when token actually changes (not on initial render)
    if (
      lastTokenRef.current !== null &&
      lastTokenRef.current !== refreshToken
    ) {
      void refetch();
    }

    lastTokenRef.current = refreshToken;
  }, [refreshToken, refetch]);
}

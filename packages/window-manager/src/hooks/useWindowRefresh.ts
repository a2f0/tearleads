import { useCallback, useState } from 'react';

export interface UseWindowRefreshResult {
  /**
   * Current refresh token value. Pass this to child components
   * that should re-render/refetch when mutations occur.
   */
  refreshToken: number;

  /**
   * Increment the refresh token to trigger a refresh cycle.
   * Call this after mutations (upload, delete, drag-drop, paste).
   */
  triggerRefresh: () => void;
}

/**
 * Hook to manage refresh token state in window components.
 *
 * This standardizes the refresh token pattern used by windows to coordinate
 * data re-fetching across child components after mutations like uploads,
 * deletions, drag-drop moves, or paste operations.
 *
 * @example
 * ```tsx
 * function FilesWindow() {
 *   const { refreshToken, triggerRefresh } = useWindowRefresh();
 *
 *   const handleUploadComplete = useCallback(() => {
 *     triggerRefresh();
 *   }, [triggerRefresh]);
 *
 *   const handleDeleted = useCallback(() => {
 *     setSelectedFileId(null);
 *     triggerRefresh();
 *   }, [triggerRefresh]);
 *
 *   return (
 *     <FilesWindowContent
 *       refreshToken={refreshToken}
 *       onUploadComplete={handleUploadComplete}
 *       onDeleted={handleDeleted}
 *     />
 *   );
 * }
 * ```
 */
export function useWindowRefresh(): UseWindowRefreshResult {
  const [refreshToken, setRefreshToken] = useState(0);

  const triggerRefresh = useCallback(() => {
    setRefreshToken((prev) => prev + 1);
  }, []);

  return { refreshToken, triggerRefresh };
}

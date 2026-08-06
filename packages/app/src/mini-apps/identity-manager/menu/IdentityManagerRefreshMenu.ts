import { useWindowRefreshMenuItem } from "../../../components/window/WindowMenuContext";

export function useIdentityManagerRefreshMenu({
  canManageSessions,
  loadingSessions,
  mutatingSessionId,
  refreshSessions,
}: {
  readonly canManageSessions: boolean;
  readonly loadingSessions: boolean;
  readonly mutatingSessionId: string | null;
  readonly refreshSessions: () => Promise<void>;
}): void {
  useWindowRefreshMenuItem(
    canManageSessions
      ? {
          disabled: loadingSessions || mutatingSessionId !== null,
          onRefresh: refreshSessions,
          refreshing: loadingSessions,
        }
      : null,
  );
}

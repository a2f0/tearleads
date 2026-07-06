import type { UserSession } from "@tearleads/client-sdk";
import {
  MiniAppButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableFrame,
} from "../../components/shared/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MINI_APP_VIRTUAL_TABLE_ROW_HEIGHT,
  useMiniAppVirtualRows,
} from "../../components/shared/MiniAppVirtual";
import { useContextMenuState } from "../../components/shared/useContextMenuState";
import { useSessionTableColumns } from "./IdentityManagerSessionColumns";
import { SessionContextMenu } from "./IdentityManagerSessionContextMenu";
import { SessionTableBody } from "./IdentityManagerSessionTable";

export function SessionsSection({
  canManageSessions,
  handleEndSession,
  loadingSessions,
  mutatingSessionId,
  onOpenSessionDetail,
  refreshSessions,
  sessionError,
  sessions,
}: {
  canManageSessions: boolean;
  handleEndSession: (session: UserSession) => Promise<void>;
  loadingSessions: boolean;
  mutatingSessionId: string | null;
  onOpenSessionDetail: (sessionId: string) => void;
  refreshSessions: () => Promise<void>;
  sessionError: string | null;
  sessions: ReadonlyArray<UserSession>;
}) {
  const { columns, visibleColumnIds } = useSessionTableColumns();
  const virtualSessions = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_TABLE_ROW_HEIGHT,
    rows: sessions,
  });
  const contextMenuState = useContextMenuState<string>();
  const contextMenuSession =
    sessions.find(
      (session) => session.id === contextMenuState.contextMenu?.id,
    ) ?? null;

  return (
    <>
      <MiniAppSection className="identity-manager-sessions">
        <MiniAppSectionHeading>
          <h2>Active Sessions</h2>
          {canManageSessions && (
            <MiniAppButton
              disabled={loadingSessions || mutatingSessionId !== null}
              variant="ghost"
              onClick={() => void refreshSessions()}
            >
              Refresh
            </MiniAppButton>
          )}
        </MiniAppSectionHeading>
        {sessionError && (
          <MiniAppStatus tone="error">{sessionError}</MiniAppStatus>
        )}
        {!canManageSessions ? (
          <MiniAppStatus>Login to manage sessions.</MiniAppStatus>
        ) : (
          <MiniAppTableFrame
            className="identity-manager-session-table mini-app-table-frame--virtual"
            ref={virtualSessions.frameRef}
            style={getMiniAppVirtualFrameStyle(
              MINI_APP_VIRTUAL_TABLE_ROW_HEIGHT,
            )}
          >
            <MiniAppTable columns={columns}>
              <SessionTableBody
                bottomPadding={virtualSessions.bottomPadding}
                loadingSessions={loadingSessions}
                mutatingSessionId={mutatingSessionId}
                onOpenSessionDetail={onOpenSessionDetail}
                openSessionContextMenu={contextMenuState.openContextMenu}
                selectedSessionId={contextMenuState.contextMenu?.id ?? null}
                sessionCount={sessions.length}
                sessions={virtualSessions.rows}
                topPadding={virtualSessions.topPadding}
                visibleColumnIds={visibleColumnIds}
              />
            </MiniAppTable>
          </MiniAppTableFrame>
        )}
      </MiniAppSection>
      <SessionContextMenu
        closeContextMenu={contextMenuState.closeContextMenu}
        handleEndSession={handleEndSession}
        mutatingSessionId={mutatingSessionId}
        onOpenSessionDetail={onOpenSessionDetail}
        position={contextMenuState.contextMenu?.position ?? null}
        session={contextMenuSession}
      />
    </>
  );
}

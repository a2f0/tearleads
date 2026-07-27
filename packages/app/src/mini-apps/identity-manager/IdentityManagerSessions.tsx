import type { UserSession } from "@tearleads/client-sdk";
import {
  MiniAppButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableFrame,
  useMiniAppCompactTableFrame,
} from "../../components/mini-app/MiniAppTable";
import { getMiniAppVirtualFrameStyle } from "../../components/mini-app/virtual/MiniAppVirtual";
import { useContextMenuState } from "../../components/shared/useContextMenuState";
import { useSessionTableColumns } from "./IdentityManagerSessionColumns";
import { SessionContextMenu } from "./IdentityManagerSessionContextMenu";
import { SessionTableBody } from "./IdentityManagerSessionTable";

// Only rendered for a session that can manage sessions — see
// IdentityManagerPrimaryScreen, which omits the section entirely when the user
// is not logged in rather than showing an empty shell inviting them to.
export function SessionsSection({
  handleEndSession,
  loadingSessions,
  mutatingSessionId,
  onOpenSessionDetail,
  refreshSessions,
  sessionError,
  sessions,
}: {
  handleEndSession: (session: UserSession) => Promise<void>;
  loadingSessions: boolean;
  mutatingSessionId: string | null;
  onOpenSessionDetail: (sessionId: string) => void;
  refreshSessions: () => Promise<void>;
  sessionError: string | null;
  sessions: ReadonlyArray<UserSession>;
}) {
  const { compact, frameRef, rowHeight } = useMiniAppCompactTableFrame();
  const { columns, visibleColumnIds } = useSessionTableColumns(compact);
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
          <MiniAppButton
            disabled={loadingSessions || mutatingSessionId !== null}
            variant="ghost"
            onClick={() => void refreshSessions()}
          >
            Refresh
          </MiniAppButton>
        </MiniAppSectionHeading>
        {sessionError && (
          <MiniAppStatus tone="error">{sessionError}</MiniAppStatus>
        )}
        <MiniAppTableFrame
          className={`identity-manager-session-table mini-app-table-frame--compact mini-app-table-frame--bleed${
            compact ? " mini-app-table-frame--two-line" : ""
          }`}
          ref={frameRef}
          style={getMiniAppVirtualFrameStyle(rowHeight)}
        >
          <MiniAppTable columns={columns}>
            <SessionTableBody
              compact={compact}
              loadingSessions={loadingSessions}
              mutatingSessionId={mutatingSessionId}
              onOpenSessionDetail={onOpenSessionDetail}
              openSessionContextMenu={contextMenuState.openContextMenu}
              selectedSessionId={contextMenuState.contextMenu?.id ?? null}
              sessions={sessions}
              visibleColumnIds={visibleColumnIds}
            />
          </MiniAppTable>
        </MiniAppTableFrame>
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

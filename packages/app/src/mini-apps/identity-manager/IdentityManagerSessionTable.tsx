import type { UserSession } from "@tearleads/client-sdk";
import type { KeyboardEvent, MouseEvent } from "react";
import {
  MiniAppTableActionButton,
  MiniAppTableCell,
  MiniAppTableEmptyRow,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../components/shared/MiniAppTable";
import { MiniAppVirtualTableSpacerRow } from "../../components/shared/MiniAppVirtual";
import { formatMiniAppDateTime } from "../../utils/formatMiniAppDate";
import type { SessionTableColumnId } from "./IdentityManagerSessionColumns";
import {
  compactIdentifier,
  formatSessionIpAddresses,
  getSessionMutationLabel,
  getSessionStatusLabel,
  isKeyboardActivationKey,
  sessionIpAddressesTitle,
  sessionIsMutating,
} from "./IdentityManagerSessionDisplay";

function renderSessionTableCell(
  columnId: SessionTableColumnId,
  params: {
    handleEndSession: (session: UserSession) => Promise<void>;
    mutatingSessionId: string | null;
    session: UserSession;
  },
) {
  const { handleEndSession, mutatingSessionId, session } = params;
  const rowIsMutating = sessionIsMutating(mutatingSessionId, session);

  switch (columnId) {
    case "status":
      return (
        <MiniAppTableCell key="status">
          <MiniAppTableText>{getSessionStatusLabel(session)}</MiniAppTableText>
        </MiniAppTableCell>
      );
    case "last-active":
      return (
        <MiniAppTableCell key="last-active">
          <MiniAppTableText truncate={false}>
            {formatMiniAppDateTime(session.lastActiveAt)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "last-ip":
      return (
        <MiniAppTableCell key="last-ip">
          <MiniAppTableText title={session.lastActiveIp ?? "No recorded IP"}>
            {session.lastActiveIp ?? "None"}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "ip-addresses":
      return (
        <MiniAppTableCell key="ip-addresses">
          <MiniAppTableText
            title={sessionIpAddressesTitle(session.ipAddresses)}
          >
            {formatSessionIpAddresses(session.ipAddresses)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "created":
      return (
        <MiniAppTableCell key="created">
          <MiniAppTableText truncate={false}>
            {formatMiniAppDateTime(session.createdAt)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "signing-key":
      return (
        <MiniAppTableCell key="signing-key">
          <MiniAppTableText title={session.signingKeyFingerprint}>
            {compactIdentifier(session.signingKeyFingerprint)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "session-id":
      return (
        <MiniAppTableCell key="session-id">
          <MiniAppTableText title={session.id}>
            {compactIdentifier(session.id)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "action":
      return (
        <MiniAppTableCell key="action">
          <MiniAppTableActionButton
            disabled={mutatingSessionId !== null}
            onClick={(event) => {
              event.stopPropagation();
              void handleEndSession(session);
            }}
          >
            {rowIsMutating ? "Working..." : getSessionMutationLabel(session)}
          </MiniAppTableActionButton>
        </MiniAppTableCell>
      );
  }
}

function SessionTableRow({
  handleEndSession,
  mutatingSessionId,
  onOpenSessionDetail,
  openSessionContextMenu,
  selected,
  session,
  visibleColumnIds,
}: {
  handleEndSession: (session: UserSession) => Promise<void>;
  mutatingSessionId: string | null;
  onOpenSessionDetail: (sessionId: string) => void;
  openSessionContextMenu: (
    event: MouseEvent<HTMLElement>,
    sessionId: string,
  ) => void;
  selected: boolean;
  session: UserSession;
  visibleColumnIds: ReadonlyArray<SessionTableColumnId>;
}) {
  const openSessionDetail = () => onOpenSessionDetail(session.id);
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (!isKeyboardActivationKey(event.key)) {
      return;
    }

    if (event.target !== event.currentTarget) {
      return;
    }

    event.preventDefault();
    openSessionDetail();
  };

  return (
    <MiniAppTableRow
      aria-selected={selected}
      interactive
      onClick={openSessionDetail}
      onContextMenu={(event) => openSessionContextMenu(event, session.id)}
      onKeyDown={handleKeyDown}
      selected={selected}
      tabIndex={0}
    >
      {visibleColumnIds.map((columnId) =>
        renderSessionTableCell(columnId, {
          handleEndSession,
          mutatingSessionId,
          session,
        }),
      )}
    </MiniAppTableRow>
  );
}

export function SessionTableBody({
  bottomPadding,
  handleEndSession,
  loadingSessions,
  mutatingSessionId,
  onOpenSessionDetail,
  openSessionContextMenu,
  selectedSessionId,
  sessionCount,
  sessions,
  topPadding,
  visibleColumnIds,
}: {
  bottomPadding: number;
  handleEndSession: (session: UserSession) => Promise<void>;
  loadingSessions: boolean;
  mutatingSessionId: string | null;
  onOpenSessionDetail: (sessionId: string) => void;
  openSessionContextMenu: (
    event: MouseEvent<HTMLElement>,
    sessionId: string,
  ) => void;
  selectedSessionId: string | null;
  sessionCount: number;
  sessions: ReadonlyArray<UserSession>;
  topPadding: number;
  visibleColumnIds: ReadonlyArray<SessionTableColumnId>;
}) {
  if (sessionCount === 0) {
    return (
      <MiniAppTableEmptyRow colSpan={visibleColumnIds.length}>
        {loadingSessions ? "Loading sessions..." : "No active sessions."}
      </MiniAppTableEmptyRow>
    );
  }

  return (
    <>
      <MiniAppVirtualTableSpacerRow
        colSpan={visibleColumnIds.length}
        height={topPadding}
      />
      {sessions.map((session) => (
        <SessionTableRow
          handleEndSession={handleEndSession}
          key={session.id}
          mutatingSessionId={mutatingSessionId}
          onOpenSessionDetail={onOpenSessionDetail}
          openSessionContextMenu={openSessionContextMenu}
          selected={selectedSessionId === session.id}
          session={session}
          visibleColumnIds={visibleColumnIds}
        />
      ))}
      <MiniAppVirtualTableSpacerRow
        colSpan={visibleColumnIds.length}
        height={bottomPadding}
      />
    </>
  );
}

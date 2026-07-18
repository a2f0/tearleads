import type { UserSession } from "@tearleads/client-sdk";
import type { KeyboardEvent, MouseEvent } from "react";
import {
  MiniAppRowActionsButton,
  MiniAppTableCell,
  MiniAppTableEmptyRow,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../components/mini-app/MiniAppTable";
import { MiniAppVirtualTableSpacerRow } from "../../components/mini-app/virtual/MiniAppVirtual";
import { formatMiniAppDateTime } from "../../utils/formatMiniAppDate";
import type { SessionTableColumnId } from "./IdentityManagerSessionColumns";
import {
  compactIdentifier,
  formatSessionIpAddresses,
  getSessionStatusLabel,
  isKeyboardActivationKey,
  sessionIpAddressesTitle,
  sessionIsMutating,
} from "./IdentityManagerSessionDisplay";

function getSessionActionsButtonLabel(session: UserSession): string {
  const sessionDescriptor =
    session.lastActiveIp ?? compactIdentifier(session.id);
  return `Actions for ${getSessionStatusLabel(session)} session ${sessionDescriptor}`;
}

function renderSessionTableCell(
  columnId: SessionTableColumnId,
  params: {
    mutatingSessionId: string | null;
    openSessionContextMenu: (
      event: MouseEvent<HTMLElement>,
      sessionId: string,
    ) => void;
    session: UserSession;
  },
) {
  const { mutatingSessionId, openSessionContextMenu, session } = params;
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
    case "action": {
      const actionsLabel = getSessionActionsButtonLabel(session);
      return (
        <MiniAppTableCell className="mini-app-row-actions-cell" key="action">
          <MiniAppRowActionsButton
            aria-busy={rowIsMutating || undefined}
            aria-label={actionsLabel}
            onClick={(event) => {
              event.stopPropagation();
              openSessionContextMenu(event, session.id);
            }}
            title={actionsLabel}
          />
        </MiniAppTableCell>
      );
    }
  }
}

function SessionTableRow({
  mutatingSessionId,
  onOpenSessionDetail,
  openSessionContextMenu,
  selected,
  session,
  visibleColumnIds,
}: {
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
          mutatingSessionId,
          openSessionContextMenu,
          session,
        }),
      )}
    </MiniAppTableRow>
  );
}

export function SessionTableBody({
  bottomPadding,
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

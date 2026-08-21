import type { UserSession } from "@symcrypt/client-sdk";
import type { KeyboardEvent, MouseEvent } from "react";
import {
  MiniAppCompactTableCell,
  type MiniAppCompactTableField,
  MiniAppRowActionsButton,
  MiniAppTableCell,
  MiniAppTableEmptyRow,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../../components/mini-app/MiniAppTable";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import { isKeyboardActivationKey } from "../../../utils/keyboardActivation";
import {
  SESSION_COLUMN_LABELS,
  SESSION_COMPACT_PRIMARY_COLUMN_IDS,
  SESSION_COMPACT_SECONDARY_COLUMN_IDS,
  type SessionDataColumnId,
  type SessionTableColumnId,
} from "./IdentityManagerSessionColumns";
import {
  compactIdentifier,
  formatSessionIpAddresses,
  getSessionStatusLabel,
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

function getSessionCompactField(
  columnId: SessionDataColumnId,
  session: UserSession,
): MiniAppCompactTableField {
  const label = SESSION_COLUMN_LABELS[columnId];
  switch (columnId) {
    case "status":
      return { id: columnId, label, text: getSessionStatusLabel(session) };
    case "last-active":
      return {
        id: columnId,
        label,
        text: formatMiniAppDateTime(session.lastActiveAt),
      };
    case "last-ip":
      return {
        id: columnId,
        label,
        text: session.lastActiveIp ?? "None",
        title: session.lastActiveIp ?? "No recorded IP",
      };
    case "ip-addresses":
      return {
        id: columnId,
        label,
        text: formatSessionIpAddresses(session.ipAddresses),
        title: sessionIpAddressesTitle(session.ipAddresses),
      };
    case "created":
      return {
        id: columnId,
        label,
        text: formatMiniAppDateTime(session.createdAt),
      };
    case "signing-key":
      return {
        id: columnId,
        label,
        text: compactIdentifier(session.signingKeyFingerprint),
        title: session.signingKeyFingerprint,
      };
    case "session-id":
      return {
        id: columnId,
        label,
        text: compactIdentifier(session.id),
        title: session.id,
      };
  }
}

function SessionTableRow({
  compact,
  mutatingSessionId,
  onOpenSessionDetail,
  openSessionContextMenu,
  selected,
  session,
  visibleColumnIds,
}: {
  compact: boolean;
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
      {compact ? (
        <MiniAppCompactTableCell
          primary={SESSION_COMPACT_PRIMARY_COLUMN_IDS.filter((id) =>
            visibleColumnIds.includes(id),
          ).map((id) => getSessionCompactField(id, session))}
          secondary={SESSION_COMPACT_SECONDARY_COLUMN_IDS.filter((id) =>
            visibleColumnIds.includes(id),
          ).map((id) => getSessionCompactField(id, session))}
        />
      ) : (
        visibleColumnIds
          .filter((columnId) => columnId !== "action")
          .map((columnId) =>
            renderSessionTableCell(columnId, {
              mutatingSessionId,
              openSessionContextMenu,
              session,
            }),
          )
      )}
      {renderSessionTableCell("action", {
        mutatingSessionId,
        openSessionContextMenu,
        session,
      })}
    </MiniAppTableRow>
  );
}

export function SessionTableBody({
  compact,
  loadingSessions,
  mutatingSessionId,
  onOpenSessionDetail,
  openSessionContextMenu,
  selectedSessionId,
  sessions,
  visibleColumnIds,
}: {
  compact: boolean;
  loadingSessions: boolean;
  mutatingSessionId: string | null;
  onOpenSessionDetail: (sessionId: string) => void;
  openSessionContextMenu: (
    event: MouseEvent<HTMLElement>,
    sessionId: string,
  ) => void;
  selectedSessionId: string | null;
  sessions: ReadonlyArray<UserSession>;
  visibleColumnIds: ReadonlyArray<SessionTableColumnId>;
}) {
  if (sessions.length === 0) {
    return (
      <MiniAppTableEmptyRow colSpan={visibleColumnIds.length}>
        {loadingSessions ? "Loading sessions..." : "No active sessions."}
      </MiniAppTableEmptyRow>
    );
  }

  return (
    <>
      {sessions.map((session) => (
        <SessionTableRow
          compact={compact}
          key={session.id}
          mutatingSessionId={mutatingSessionId}
          onOpenSessionDetail={onOpenSessionDetail}
          openSessionContextMenu={openSessionContextMenu}
          selected={selectedSessionId === session.id}
          session={session}
          visibleColumnIds={visibleColumnIds}
        />
      ))}
    </>
  );
}

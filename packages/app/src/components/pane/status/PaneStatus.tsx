import {
  MiniAppInfoRow,
  MiniAppInfoTable,
} from "../../../components/mini-app/MiniAppTable";
import { useNetworkModeContextMenu } from "../../../components/shared/NetworkModeContextMenu";
import {
  NO_STATUS_VALUE,
  STATUS_LABELS,
  useSystemStatusSnapshot,
} from "./useSystemStatusSnapshot";

export function PaneStatus({ pinned = false }: { pinned?: boolean } = {}) {
  const status = useSystemStatusSnapshot();
  const networkContextMenu = useNetworkModeContextMenu();

  return (
    <section
      aria-label="System status"
      className="pane-content"
      onContextMenu={networkContextMenu.handleContextMenu}
    >
      <MiniAppInfoTable
        className={pinned ? "mini-app-info-table--pinned" : undefined}
      >
        <tbody>
          <MiniAppInfoRow label={STATUS_LABELS.sqliteWorker}>
            {status.sqliteWorker}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={STATUS_LABELS.id}>{status.id}</MiniAppInfoRow>
          <MiniAppInfoRow label={STATUS_LABELS.publicKey}>
            {status.publicKey}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={STATUS_LABELS.userId}>
            {status.userId}
          </MiniAppInfoRow>
          {status.peerUserId === null ? null : (
            <MiniAppInfoRow label={STATUS_LABELS.peerUserId}>
              {status.peerUserId}
            </MiniAppInfoRow>
          )}
          <MiniAppInfoRow label={STATUS_LABELS.session}>
            {status.session}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={STATUS_LABELS.network}>
            {status.network}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={STATUS_LABELS.ws}>{status.ws}</MiniAppInfoRow>
          <MiniAppInfoRow label={STATUS_LABELS.events}>
            {status.events.length === 0
              ? NO_STATUS_VALUE
              : status.events.map((event) => (
                  <div key={event.id}>{event.label}</div>
                ))}
          </MiniAppInfoRow>
        </tbody>
      </MiniAppInfoTable>
      {networkContextMenu.contextMenu}
    </section>
  );
}

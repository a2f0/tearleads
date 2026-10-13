import {
  MiniAppInfoRow,
  MiniAppInfoTable,
  MiniAppTable,
  MiniAppTableCell,
  MiniAppTableEmptyRow,
  MiniAppTableRow,
} from "../../../components/mini-app/MiniAppTable";
import { useApiRequestMetrics } from "../../../providers/api/useApiRequestMetrics";

const columns = [
  { id: "endpoint", header: "Endpoint" },
  { id: "total", header: "Requests" },
  { id: "inFlight", header: "In flight" },
  { id: "succeeded", header: "Succeeded" },
  { id: "failed", header: "Failed" },
  { id: "cancelled", header: "Cancelled" },
];

export function SystemMonitorRequests() {
  const { snapshot, hasIdentity, reset } = useApiRequestMetrics();
  return (
    <section
      aria-label="API request counts"
      className="system-monitor-requests"
    >
      <p>
        {hasIdentity
          ? "Requests for the current identity."
          : "Requests made without an identity."}{" "}
        Counts are kept in memory until reload or reset, including while this
        monitor is closed.
      </p>
      <p>
        Each HTTP attempt counts, including retries. Cached reads and WebSocket
        messages are excluded. Succeeded means HTTP 2xx/3xx; failed means HTTP
        4xx/5xx or a connection failure, even if the app handles that response.
        Counts do not include later response validation.
      </p>
      <MiniAppInfoTable className="mini-app-info-table--borderless">
        <tbody>
          <MiniAppInfoRow label="Counting since">
            {snapshot.startedAt}
          </MiniAppInfoRow>
          <MiniAppInfoRow label="Total requests">
            {snapshot.total}
          </MiniAppInfoRow>
          <MiniAppInfoRow label="In flight">{snapshot.inFlight}</MiniAppInfoRow>
          <MiniAppInfoRow label="Succeeded">
            {snapshot.succeeded}
          </MiniAppInfoRow>
          <MiniAppInfoRow label="Failed">{snapshot.failed}</MiniAppInfoRow>
          <MiniAppInfoRow label="Cancelled">
            {snapshot.cancelled}
          </MiniAppInfoRow>
        </tbody>
      </MiniAppInfoTable>
      <button className="tearleads-action-button" onClick={reset} type="button">
        Reset request counts
      </button>
      <div className="system-monitor-request-table">
        <MiniAppTable aria-label="Requests by endpoint" columns={columns}>
          {snapshot.endpoints.map((row) => (
            <MiniAppTableRow key={`${row.method} ${row.path}`}>
              <MiniAppTableCell>
                <code>
                  {row.method} {row.path}
                </code>
              </MiniAppTableCell>
              <MiniAppTableCell>{row.total}</MiniAppTableCell>
              <MiniAppTableCell>{row.inFlight}</MiniAppTableCell>
              <MiniAppTableCell>{row.succeeded}</MiniAppTableCell>
              <MiniAppTableCell>{row.failed}</MiniAppTableCell>
              <MiniAppTableCell>{row.cancelled}</MiniAppTableCell>
            </MiniAppTableRow>
          ))}
          {snapshot.endpoints.length === 0 && (
            <MiniAppTableEmptyRow colSpan={columns.length}>
              No API requests recorded yet.
            </MiniAppTableEmptyRow>
          )}
        </MiniAppTable>
      </div>
    </section>
  );
}

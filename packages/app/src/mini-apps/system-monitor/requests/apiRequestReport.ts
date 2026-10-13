import type { ApiRequestMetricsSnapshot } from "@tearleads/client-sdk";
import { formatTable } from "../report/reportTables";

export function formatApiRequestReport(
  snapshot: ApiRequestMetricsSnapshot,
): string[] {
  return [
    "## API Requests",
    "",
    "Current identity; in-memory HTTP attempts since reload or reset. Includes retries; excludes cached reads and WebSockets. Succeeded means HTTP 2xx/3xx; failed means HTTP 4xx/5xx or connection failure, including responses the app handles. Excludes later response validation.",
    "",
    formatTable(
      ["Field", "Value"],
      [
        ["Counting since", snapshot.startedAt],
        ["Total requests", String(snapshot.total)],
        ["In flight", String(snapshot.inFlight)],
        ["Succeeded", String(snapshot.succeeded)],
        ["Failed", String(snapshot.failed)],
        ["Cancelled", String(snapshot.cancelled)],
      ],
    ),
    "",
    formatTable(
      ["Endpoint", "Requests", "In flight", "Succeeded", "Failed", "Cancelled"],
      snapshot.endpoints.map((row) => [
        `${row.method} ${row.path}`,
        String(row.total),
        String(row.inFlight),
        String(row.succeeded),
        String(row.failed),
        String(row.cancelled),
      ]),
    ),
  ];
}

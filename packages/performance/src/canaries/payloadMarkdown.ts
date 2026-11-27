import type {
  FieldByteTotal,
  PayloadAuditSummary,
} from "./payloadAuditSummary";

const integers = new Intl.NumberFormat("en-US");

function pct(part: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function formatFields(fields: readonly FieldByteTotal[]): string {
  if (fields.length === 0) return "";
  return fields
    .slice(0, 3)
    .map((entry) => `\`${entry.field}\` (${integers.format(entry.bytes)} B)`)
    .join(", ");
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|");
}

function routePayloadTable(summary: PayloadAuditSummary): string[] {
  if (summary.byRoute.length === 0) return [];
  return [
    "",
    "### Payload by route",
    "",
    "| Route | Reqs | Req B | Resp B | Echo B | Redeliv B | Re-dl upload B | Citations | Top response fields |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...summary.byRoute
      .slice(0, 20)
      .map(
        (route) =>
          `| \`${cell(route.route)}\` | ${integers.format(route.requests)} | ${integers.format(route.requestBytes)} | ${integers.format(route.responseBytes)} | ${integers.format(route.echoBytes)} | ${integers.format(route.redeliveredBytes)} | ${integers.format(route.reDownloadedUploadBytes)} | ${integers.format(route.manifestCitations)} | ${formatFields(route.topResponseFields)} |`,
      ),
  ];
}

function paneTable(summary: PayloadAuditSummary): string[] {
  if (summary.byPane.length === 0) return [];
  return [
    "",
    "### Payload by pane",
    "",
    "| Pane | Reqs | Req B | Resp B | Redelivered B | Re-downloaded upload B |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...summary.byPane.map(
      (pane) =>
        `| \`${pane.pane}\` | ${integers.format(pane.requests)} | ${integers.format(pane.requestBytes)} | ${integers.format(pane.responseBytes)} | ${integers.format(pane.redeliveredBytes)} | ${integers.format(pane.reDownloadedUploadBytes)} |`,
    ),
  ];
}

function headRereadTable(summary: PayloadAuditSummary): string[] {
  if (summary.exactHeadRereads.length === 0) return [];
  return [
    "",
    "### Exact-head re-reads",
    "",
    "| Pane | Route | Principal | Version | State hash | Extra reads |",
    "| --- | --- | --- | --- | --- | ---: |",
    ...summary.exactHeadRereads
      .slice(0, 20)
      .map(
        (item) =>
          `| \`${item.pane}\` | \`${cell(item.route)}\` | \`${cell(item.principal)}\` | ${cell(item.version)} | \`${item.stateHash}\` | ${integers.format(item.extraReads)} |`,
      ),
  ];
}

function issuerTable(summary: PayloadAuditSummary): string[] {
  if (summary.topIssuers.length === 0) return [];
  return [
    "",
    "### Repeated issuer stacks",
    "",
    "| Count | Route | Stack |",
    "| ---: | --- | --- |",
    ...summary.topIssuers.map(
      (item) =>
        `| ${integers.format(item.count)} | \`${cell(item.route)}\` | \`${cell(item.stack)}\` |`,
    ),
  ];
}

/** Formats one canary or combined payload audit summary as Markdown. */
export function formatPayloadAuditMarkdown(
  heading: string,
  summary: PayloadAuditSummary,
): string[] {
  const wasteBytes =
    summary.echoBytes +
    summary.redeliveredBytes +
    summary.reDownloadedUploadBytes;
  return [
    "",
    `## ${heading}`,
    "",
    `${integers.format(summary.requests)} requests, ` +
      `${integers.format(summary.requestBytes)} B sent, ` +
      `${integers.format(summary.responseBytes)} B received. ` +
      `Tracked wire repeat/echo: ${integers.format(wasteBytes)} B (${pct(wasteBytes, summary.responseBytes)} of responses: ` +
      `${integers.format(summary.echoBytes)} B echo, ` +
      `${integers.format(summary.redeliveredBytes)} B redelivered, ` +
      `${integers.format(summary.reDownloadedUploadBytes)} B uploaded-then-redownloaded). ` +
      `Manifest citations: ${integers.format(summary.manifestCitations)}; ` +
      `exact-head re-reads: ${integers.format(summary.exactHeadRereadsCount)}.`,
    ...paneTable(summary),
    ...routePayloadTable(summary),
    ...headRereadTable(summary),
    ...issuerTable(summary),
  ];
}

import type { PayloadRequestRecord } from "./payloadAudit";

export interface FieldByteTotal {
  readonly field: string;
  readonly bytes: number;
}

export interface RoutePayloadSummary {
  readonly route: string;
  readonly requests: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly echoBytes: number;
  readonly redeliveredBytes: number;
  readonly reDownloadedUploadBytes: number;
  readonly manifestCitations: number;
  readonly topRequestFields: readonly FieldByteTotal[];
  readonly topResponseFields: readonly FieldByteTotal[];
}

export interface PanePayloadSummary {
  readonly pane: string;
  readonly requests: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly redeliveredBytes: number;
  readonly reDownloadedUploadBytes: number;
}

export interface ExactHeadReread {
  readonly pane: string;
  readonly route: string;
  readonly principal: string;
  readonly version: string;
  readonly stateHash: string;
  readonly extraReads: number;
}

export interface IssuerStackCount {
  readonly route: string;
  readonly stack: string;
  readonly count: number;
}

export interface PayloadAuditSummary {
  readonly requests: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly echoBytes: number;
  readonly redeliveredBytes: number;
  readonly reDownloadedUploadBytes: number;
  readonly manifestCitations: number;
  readonly exactHeadRereadsCount: number;
  readonly byPane: readonly PanePayloadSummary[];
  readonly byRoute: readonly RoutePayloadSummary[];
  readonly exactHeadRereads: readonly ExactHeadReread[];
  readonly topIssuers: readonly IssuerStackCount[];
}

function isPayloadRequestRecord(value: unknown): value is PayloadRequestRecord {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "phase") === "string" &&
    typeof Reflect.get(value, "pane") === "string" &&
    typeof Reflect.get(value, "route") === "string" &&
    typeof Reflect.get(value, "status") === "number" &&
    typeof Reflect.get(value, "requestBytes") === "number" &&
    typeof Reflect.get(value, "responseBytes") === "number"
  );
}

export function parsePayloadAudit(text: string): PayloadRequestRecord[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      const value: unknown = JSON.parse(line);
      if (!isPayloadRequestRecord(value)) {
        throw new Error(`Payload audit line ${index + 1} is invalid.`);
      }
      return value;
    });
}

function topFields(
  totals: ReadonlyMap<string, number>,
  limit = 5,
): FieldByteTotal[] {
  return [...totals]
    .map(([field, bytes]) => ({ field, bytes }))
    .sort(
      (a, b) =>
        b.bytes - a.bytes ||
        (a.field < b.field ? -1 : a.field > b.field ? 1 : 0),
    )
    .slice(0, limit);
}

function addFields(
  target: Map<string, number>,
  fields: Readonly<Record<string, number>>,
): void {
  for (const [field, bytes] of Object.entries(fields)) {
    target.set(field, (target.get(field) ?? 0) + bytes);
  }
}

function summarizePanes(
  records: readonly PayloadRequestRecord[],
): PanePayloadSummary[] {
  const map = new Map<
    string,
    {
      requests: number;
      requestBytes: number;
      responseBytes: number;
      redeliveredBytes: number;
      reDownloadedUploadBytes: number;
    }
  >();
  for (const rec of records) {
    const entry = map.get(rec.pane) ?? {
      requests: 0,
      requestBytes: 0,
      responseBytes: 0,
      redeliveredBytes: 0,
      reDownloadedUploadBytes: 0,
    };
    entry.requests += 1;
    entry.requestBytes += rec.requestBytes;
    entry.responseBytes += rec.responseBytes;
    entry.redeliveredBytes += rec.redeliveredBytes;
    entry.reDownloadedUploadBytes += rec.reDownloadedUploadBytes;
    map.set(rec.pane, entry);
  }
  return [...map]
    .map(([pane, stats]) => ({ pane, ...stats }))
    .sort(
      (a, b) =>
        b.responseBytes + b.requestBytes - (a.responseBytes + a.requestBytes),
    );
}

function summarizeRoutes(
  records: readonly PayloadRequestRecord[],
): RoutePayloadSummary[] {
  const map = new Map<
    string,
    {
      requests: number;
      requestBytes: number;
      responseBytes: number;
      echoBytes: number;
      redeliveredBytes: number;
      reDownloadedUploadBytes: number;
      manifestCitations: number;
      reqFields: Map<string, number>;
      resFields: Map<string, number>;
    }
  >();
  for (const rec of records) {
    const entry = map.get(rec.route) ?? {
      requests: 0,
      requestBytes: 0,
      responseBytes: 0,
      echoBytes: 0,
      redeliveredBytes: 0,
      reDownloadedUploadBytes: 0,
      manifestCitations: 0,
      reqFields: new Map(),
      resFields: new Map(),
    };
    entry.requests += 1;
    entry.requestBytes += rec.requestBytes;
    entry.responseBytes += rec.responseBytes;
    entry.echoBytes += rec.echoBytes;
    entry.redeliveredBytes += rec.redeliveredBytes;
    entry.reDownloadedUploadBytes += rec.reDownloadedUploadBytes;
    entry.manifestCitations += rec.knownManifestsCount;
    addFields(entry.reqFields, rec.requestFieldBytes);
    addFields(entry.resFields, rec.responseFieldBytes);
    map.set(rec.route, entry);
  }
  return [...map]
    .map(([route, stats]) => ({
      route,
      requests: stats.requests,
      requestBytes: stats.requestBytes,
      responseBytes: stats.responseBytes,
      echoBytes: stats.echoBytes,
      redeliveredBytes: stats.redeliveredBytes,
      reDownloadedUploadBytes: stats.reDownloadedUploadBytes,
      manifestCitations: stats.manifestCitations,
      topRequestFields: topFields(stats.reqFields),
      topResponseFields: topFields(stats.resFields),
    }))
    .sort(
      (a, b) =>
        b.responseBytes + b.requestBytes - (a.responseBytes + a.requestBytes),
    );
}

function summarizeHeadRereads(
  records: readonly PayloadRequestRecord[],
): ExactHeadReread[] {
  const counts = new Map<
    string,
    {
      pane: string;
      route: string;
      principal: string;
      version: string;
      stateHash: string;
      count: number;
    }
  >();
  for (const rec of records) {
    if (!rec.policyHead) continue;
    const key = `${rec.pane}\0${rec.route}\0${rec.policyHead.principal}\0${rec.policyHead.version}\0${rec.policyHead.stateHash}`;
    const entry = counts.get(key) ?? {
      pane: rec.pane,
      route: rec.route,
      ...rec.policyHead,
      count: 0,
    };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()]
    .filter((entry) => entry.count > 1)
    .map(({ count, ...rest }) => ({ ...rest, extraReads: count - 1 }))
    .sort((a, b) => b.extraReads - a.extraReads);
}

function summarizeIssuers(
  records: readonly PayloadRequestRecord[],
): IssuerStackCount[] {
  const counts = new Map<
    string,
    { route: string; stack: string; count: number }
  >();
  for (const rec of records) {
    if (!rec.issuerStack) continue;
    const key = `${rec.route}\0${rec.issuerStack}`;
    const entry = counts.get(key) ?? {
      route: rec.route,
      stack: rec.issuerStack,
      count: 0,
    };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()]
    .filter((entry) => entry.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
}

export function summarizePayloadAudit(
  records: readonly PayloadRequestRecord[],
): PayloadAuditSummary {
  let requestBytes = 0;
  let responseBytes = 0;
  let echoBytes = 0;
  let redeliveredBytes = 0;
  let reDownloadedUploadBytes = 0;
  let manifestCitations = 0;
  for (const rec of records) {
    requestBytes += rec.requestBytes;
    responseBytes += rec.responseBytes;
    echoBytes += rec.echoBytes;
    redeliveredBytes += rec.redeliveredBytes;
    reDownloadedUploadBytes += rec.reDownloadedUploadBytes;
    manifestCitations += rec.knownManifestsCount;
  }
  const exactHeadRereads = summarizeHeadRereads(records);
  return {
    requests: records.length,
    requestBytes,
    responseBytes,
    echoBytes,
    redeliveredBytes,
    reDownloadedUploadBytes,
    manifestCitations,
    exactHeadRereadsCount: exactHeadRereads.reduce(
      (sum, item) => sum + item.extraReads,
      0,
    ),
    byPane: summarizePanes(records),
    byRoute: summarizeRoutes(records),
    exactHeadRereads,
    topIssuers: summarizeIssuers(records),
  };
}

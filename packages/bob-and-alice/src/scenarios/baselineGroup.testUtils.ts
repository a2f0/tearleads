import type { Exchange, ObservedRequest } from "../harness/transport";

const MEBIBYTE = 1024 * 1024;
const LINE_BYTES = 64;

/**
 * About `mebibytes` of text in lines no encoding shrinks. The SDK cuts a
 * rotation baseline at about 4 MiB of history a segment and no host of the
 * `Tearleads` runtime can ask for less, so a baseline of several segments
 * takes a history this large.
 */
export function largeText(mebibytes: number): string {
  const lines: string[] = [];
  const random = new Uint8Array((LINE_BYTES - 1) / 2 + 1);
  for (let bytes = 0; bytes < mebibytes * MEBIBYTE; bytes += LINE_BYTES) {
    crypto.getRandomValues(random);
    lines.push(random.toHex().slice(0, LINE_BYTES - 1));
  }
  return `${lines.join("\n")}\n`;
}

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null
    ? Reflect.get(body, name)
    : undefined;
}

function list(body: unknown, name: string): unknown[] {
  const value = field(body, name);
  return Array.isArray(value) ? value : [];
}

/** Matches every sync request of `documentId`, with or without writes. */
export function documentSync(documentId: string) {
  return (request: ObservedRequest): boolean =>
    request.method === "POST" &&
    request.path.endsWith(`/documents/${documentId}/sync`);
}

/** What one sync request of a document asked for, and how it was answered. */
export interface ObservedSync {
  readonly errorCode: string | undefined;
  readonly historyMode: unknown;
  readonly outgoing: number;
  readonly pullCursor: unknown;
  readonly status: number | undefined;
  readonly version: unknown;
}

/** The answered sync requests of `documentId` in `history`, in order. */
export function observedSyncs(
  history: readonly Exchange[],
  documentId: string,
): ObservedSync[] {
  return history
    .filter(documentSync(documentId))
    .filter((exchange) => exchange.status !== undefined)
    .map((exchange) => ({
      errorCode: exchange.errorCode,
      historyMode: field(exchange.body, "historyMode"),
      outgoing: list(exchange.body, "outgoingUpdates").length,
      pullCursor: field(exchange.body, "pullCursor"),
      status: exchange.status,
      version: field(exchange.body, "localVersionVector"),
    }));
}

/** How many segments the rotation baseline of an unlink request carries. */
export function unlinkBaselineSegments(history: readonly Exchange[]): number {
  return Math.max(
    0,
    ...history.map(({ body }) => list(body, "rotationBaseline").length),
  );
}

/** A sync request's body asking for pages of at most `updates` updates. */
export function withPageLimit(updates: number) {
  return (body: unknown): unknown =>
    typeof body === "object" && body !== null
      ? { ...body, maxPageUpdates: updates }
      : body;
}

/**
 * A sync response's body without the first segment of each rotation
 * baseline it serves: what a server that withholds a segment answers.
 */
export function withoutFirstBaselineSegments(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return body;
  return {
    ...body,
    updates: list(body, "updates").filter(
      (update) => field(update, "baselineSegmentIndex") !== 0,
    ),
  };
}

/** How many of a sync response's updates are rotation baseline segments. */
export function servedBaselineSegments(body: unknown): number {
  return list(body, "updates").filter(
    (update) => field(update, "baselineId") !== undefined,
  ).length;
}

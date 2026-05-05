import { createHmac, timingSafeEqual } from "node:crypto";
import { parseWalLsn } from "@tearleads/validators/util";
import type { DatabaseSession } from "../../adapters/postgres";
import { readCurrentCommitLsn } from "../../documents/commitLsn";

export type ContainerSyncLane = "containers" | "containerDocuments";

export interface ContainerSyncWatermark {
  readonly updatedAt: string;
  readonly id: string;
}

export interface ContainerSyncCursorPayload {
  readonly v: 1;
  readonly lane: ContainerSyncLane;
  readonly scope: Record<string, string | number>;
  readonly readBarrier: {
    readonly commitLsn: string;
  };
  readonly watermark: ContainerSyncWatermark | null;
  readonly issuedAt: string;
}

export class ContainerSyncCursorError extends Error {
  constructor(message = "Invalid sync cursor") {
    super(message);
    this.name = "ContainerSyncCursorError";
  }
}

function syncCursorSecret(): string {
  const { TEARLEADS_SYNC_CURSOR_SECRET } = process.env;
  return (
    TEARLEADS_SYNC_CURSOR_SECRET ??
    "tearleads-local-container-sync-cursor-secret"
  );
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", syncCursorSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function timingSafeEqualStrings(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.byteLength === rightBuffer.byteLength &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isWatermark(value: unknown): value is ContainerSyncWatermark {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "updatedAt") === "string" &&
    typeof Reflect.get(value, "id") === "string"
  );
}

function isCursorPayload(value: unknown): value is ContainerSyncCursorPayload {
  const readBarrier =
    typeof value === "object" && value !== null
      ? Reflect.get(value, "readBarrier")
      : undefined;
  const watermark =
    typeof value === "object" && value !== null
      ? Reflect.get(value, "watermark")
      : undefined;

  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "v") === 1 &&
    (Reflect.get(value, "lane") === "containers" ||
      Reflect.get(value, "lane") === "containerDocuments") &&
    typeof Reflect.get(value, "scope") === "object" &&
    Reflect.get(value, "scope") !== null &&
    typeof readBarrier === "object" &&
    readBarrier !== null &&
    typeof Reflect.get(readBarrier, "commitLsn") === "string" &&
    (watermark === null || isWatermark(watermark)) &&
    typeof Reflect.get(value, "issuedAt") === "string"
  );
}

function encodeContainerSyncCursor(
  payload: ContainerSyncCursorPayload,
): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function decodeContainerSyncCursor(
  token: string | null | undefined,
): ContainerSyncCursorPayload | null {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra !== undefined) {
    throw new ContainerSyncCursorError();
  }

  if (!timingSafeEqualStrings(signature, signPayload(encodedPayload))) {
    throw new ContainerSyncCursorError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    throw new ContainerSyncCursorError();
  }

  if (!isCursorPayload(parsed)) {
    throw new ContainerSyncCursorError();
  }

  return parsed;
}

export function assertContainerSyncCursorScope(
  cursor: ContainerSyncCursorPayload | null,
  input: {
    readonly lane: ContainerSyncLane;
    readonly scope: Record<string, string | number>;
  },
): void {
  if (!cursor) {
    return;
  }

  if (cursor.lane !== input.lane) {
    throw new ContainerSyncCursorError();
  }

  for (const [key, value] of Object.entries(input.scope)) {
    if (cursor.scope[key] !== value) {
      throw new ContainerSyncCursorError();
    }
  }
}

export async function assertContainerSyncCursorReadBarrier(
  executor: DatabaseSession,
  cursor: ContainerSyncCursorPayload | null,
): Promise<void> {
  if (!cursor) {
    return;
  }

  const currentCommitLsn = await readCurrentCommitLsn(executor);
  if (
    parseWalLsn(currentCommitLsn) < parseWalLsn(cursor.readBarrier.commitLsn)
  ) {
    throw new ContainerSyncCursorError(
      "Requested sync cursor read barrier has not been reached",
    );
  }
}

export async function createContainerSyncCursor(input: {
  readonly executor: DatabaseSession;
  readonly lane: ContainerSyncLane;
  readonly scope: Record<string, string | number>;
  readonly watermark: ContainerSyncWatermark | null;
}): Promise<string> {
  return encodeContainerSyncCursor({
    v: 1,
    lane: input.lane,
    scope: input.scope,
    readBarrier: {
      commitLsn: await readCurrentCommitLsn(input.executor),
    },
    watermark: input.watermark,
    issuedAt: new Date().toISOString(),
  });
}

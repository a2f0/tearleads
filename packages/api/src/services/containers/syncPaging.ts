import type { SyncWatermark } from "@tearleads/validators/response";
import { type SQL, sql } from "drizzle-orm";
import { normalizeSyncTimestamp } from "./syncTimestamp";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export function normalizeSyncPageLimit(
  value: number | undefined,
  createError: () => Error,
): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw createError();
  }
  return Math.min(value, MAX_LIMIT);
}

export function normalizeSyncWatermark(
  value: SyncWatermark | null | undefined,
  createError: () => Error,
): SyncWatermark | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value.updatedAt !== "string" ||
    value.updatedAt.length === 0 ||
    typeof value.id !== "string" ||
    value.id.length === 0
  ) {
    throw createError();
  }

  const updatedAt = normalizeSyncTimestamp(value.updatedAt);
  if (updatedAt === null) {
    throw createError();
  }

  return {
    id: value.id,
    updatedAt,
  };
}

export function discoveryWatermark(
  discoveryOrder: bigint,
  id: string,
  updatedAt: string,
): SyncWatermark {
  return { id: `${discoveryOrder}/${id}`, updatedAt };
}

export function compareDiscoveryOrder(
  left: { discoveryOrder: bigint; id: string },
  right: { discoveryOrder: bigint; id: string },
): number {
  if (left.discoveryOrder !== right.discoveryOrder)
    return left.discoveryOrder < right.discoveryOrder ? -1 : 1;
  return left.id.localeCompare(right.id);
}

export function watermarkPredicate(
  orderExpression: SQL,
  idExpression: SQL,
  watermark: SyncWatermark | null | undefined,
): SQL {
  // Old clients persist and echo both opaque strings verbatim. A cursor from
  // the former clock order starts a bounded replay, including previously
  // missed rows. PostgreSQL IDs in the previous format contain no slash.
  const match = watermark?.id.match(/^(-?\d{1,19})\/(.+)$/u);
  if (!match) return sql``;
  const order = BigInt(match[1] ?? "");
  if (order < -9223372036854775808n || order > 9223372036854775807n)
    return sql``;
  return sql`and (${orderExpression}, ${idExpression}) > (${order.toString()}::bigint, ${match[2]})`;
}

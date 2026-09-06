import type { SyncWatermark } from "@tearleads/validators/response";
import { type SQL, sql } from "drizzle-orm";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";

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

export function watermarkPredicate(
  updatedAtExpression: SQL,
  idExpression: SQL,
  watermark: SyncWatermark | null | undefined,
): SQL {
  if (!watermark) {
    return sql``;
  }

  const updatedAtValue = isSqliteApiDatabase()
    ? new Date(watermark.updatedAt).getTime()
    : sql`${watermark.updatedAt}::timestamp`;
  return sql`and (${updatedAtExpression}, ${idExpression}) > (${updatedAtValue}, ${watermark.id})`;
}

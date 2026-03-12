import type { VfsSyncCursor } from '../protocol/sync-cursor.js';
import {
  normalizeOccurredAt,
  normalizeRequiredString
} from './syncClientUtilsBase.js';

export * from './syncClientUtilsBase.js';
export * from './syncClientUtilsTypes.js';
export * from './syncClientUtilsValidation.js';

export function normalizeCursor(
  cursor: VfsSyncCursor,
  fieldName: string
): VfsSyncCursor {
  const normalizedChangedAt = normalizeOccurredAt(cursor.changedAt);
  const normalizedChangeId = normalizeRequiredString(cursor.changeId);
  if (!normalizedChangedAt || !normalizedChangeId) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return {
    changedAt: normalizedChangedAt,
    changeId: normalizedChangeId
  };
}

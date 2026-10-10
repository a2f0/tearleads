import type { ExecSql } from "../../sqlite/sqlSchema";

/**
 * Attachment removals queue keys in the same commit that removes their rows.
 * References include every pending upload and held copy sharing this byte store.
 * Reference publication must use the SDK's per-key blob mutation lock.
 */
export interface DocumentOrphanBlobPersistence {
  acknowledge: (execSql: ExecSql, storageKey: string) => Promise<void>;
  isReferenced: (execSql: ExecSql, storageKey: string) => Promise<boolean>;
  list: (execSql: ExecSql, limit: number) => Promise<readonly string[]>;
  /** Sweep one bounded batch of abandoned side rows; true means more remain. */
  sweep: (execSql: ExecSql) => Promise<boolean>;
}

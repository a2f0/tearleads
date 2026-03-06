/**
 * Re-export adapter utilities from @tearleads/db/adapter.
 * Platform-specific adapter implementations in this directory import from here.
 */
export {
  convertRowsToArrays,
  extractSelectColumns,
  rowToArray
} from '@tearleads/db/adapter';

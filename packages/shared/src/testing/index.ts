/**
 * Test-only utilities - for server-side test code only.
 *
 * Exported separately via '@tearleads/shared/testing' to avoid
 * bundling test infrastructure into production or browser builds.
 */
export {
  getPoolOverride,
  setPoolOverrideForTesting
} from './poolOverride.js';

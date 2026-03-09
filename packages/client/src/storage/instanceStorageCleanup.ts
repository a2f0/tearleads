import { clearInstanceSettings } from '@tearleads/settings';
import {
  clearWindowDimensionsForInstance,
  clearWindowSnapshot
} from './windowSnapshotStorage';

/**
 * Clear all instance-scoped localStorage entries for a deleted instance.
 * Groups window snapshot, window dimensions, and settings cleanup.
 */
export function clearInstanceStorage(instanceId: string): void {
  clearWindowSnapshot(instanceId);
  clearWindowDimensionsForInstance(instanceId);
  clearInstanceSettings(instanceId);
}

import { describe, expect, it } from 'vitest';
import {
  getHelpDocIdFromRouteSegment,
  getHelpDocLabel,
  getHelpDocRouteSegment
} from './help';

describe('help constants', () => {
  it('maps doc ids to route segments', () => {
    expect(getHelpDocRouteSegment('cli')).toBe('cli');
    expect(getHelpDocRouteSegment('backupRestore')).toBe('backup-restore');
  });

  it('maps doc ids to labels', () => {
    expect(getHelpDocLabel('consoleReference')).toBe('Console Reference');
    expect(getHelpDocLabel('ci')).toBe('CI');
  });

  it('maps route segments back to doc ids', () => {
    expect(getHelpDocIdFromRouteSegment('tuxedo')).toBe('tuxedo');
    expect(getHelpDocIdFromRouteSegment('unknown-segment')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  getCapacitorBuildConfiguration,
  isCapacitorHttpEnabled,
  isCapacitorReleaseBuild
} from '../capacitor.config';

describe('capacitor.config', () => {
  it('defaults to debug builds when no configuration is provided', () => {
    expect(getCapacitorBuildConfiguration({})).toBe('Debug');
    expect(isCapacitorReleaseBuild({})).toBe(false);
    expect(isCapacitorHttpEnabled({})).toBe(true);
  });

  it('disables native HTTP for release builds', () => {
    const env = {
      CAPACITOR_BUILD_CONFIGURATION: 'Release'
    };

    expect(isCapacitorReleaseBuild(env)).toBe(true);
    expect(isCapacitorHttpEnabled(env)).toBe(false);
  });

  it('treats release-like build names as release builds', () => {
    expect(
      isCapacitorReleaseBuild({
        CAPACITOR_BUILD_CONFIGURATION: 'releaseInstrumented'
      })
    ).toBe(true);
    expect(
      isCapacitorHttpEnabled({
        CAPACITOR_BUILD_CONFIGURATION: 'releaseInstrumented'
      })
    ).toBe(false);
  });
});

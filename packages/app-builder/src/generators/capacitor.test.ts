import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../types.js';
import { generateCapacitorConfig } from './capacitor.js';

describe('generateCapacitorConfig', () => {
  const mockConfig: AppConfig = {
    id: 'test-app',
    displayName: 'Test App',
    bundleIds: {
      ios: 'com.test.app',
      android: 'com.test.app',
      desktop: 'com.test.app'
    },
    platforms: ['ios', 'android'],
    features: ['notes'],
    api: {
      productionUrl: 'https://api.test.com/v1'
    },
    theme: {
      primaryColor: '#111111',
      backgroundColor: '#222222',
      accentColor: '#333333'
    }
  };

  it('gates CapacitorHttp behind the Capacitor build configuration', () => {
    const result = generateCapacitorConfig(mockConfig);

    expect(result).toContain('CapacitorHttp');
    expect(result).toContain("env['CAPACITOR_BUILD_CONFIGURATION'] ?? 'Debug'");
    expect(result).toContain('const RELEASE_BUILD_PATTERN = /release/i;');
    expect(result).toContain('enabled: isCapacitorHttpEnabled()');
  });
});

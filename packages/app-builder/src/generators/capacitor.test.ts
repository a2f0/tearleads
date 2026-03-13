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

  it('includes CapacitorHttp plugin in generated config', () => {
    const result = generateCapacitorConfig(mockConfig);
    expect(result).toContain('CapacitorHttp');
    expect(result).toContain('enabled: true');
  });
});

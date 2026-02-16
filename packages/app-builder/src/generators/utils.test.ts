import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../types.js';
import { getUrlScheme } from './utils.js';

describe('getUrlScheme', () => {
  const mockConfig: AppConfig = {
    id: 'test-app',
    displayName: 'Test App',
    bundleIds: {
      ios: 'com.test.iosapp',
      android: 'com.test.androidapp',
      desktop: 'com.test.app'
    },
    platforms: ['ios', 'android'],
    features: ['notes'],
    api: { productionUrl: 'https://api.test.com/v1' },
    theme: {
      primaryColor: '#000',
      backgroundColor: '#fff',
      accentColor: '#ccc'
    }
  };

  it('should return explicit urlScheme if provided', () => {
    const config = { ...mockConfig, urlScheme: 'customscheme' };
    expect(getUrlScheme(config, 'ios')).toBe('customscheme');
    expect(getUrlScheme(config, 'android')).toBe('customscheme');
  });

  it('should derive scheme from ios bundle id', () => {
    expect(getUrlScheme(mockConfig, 'ios')).toBe('iosapp');
  });

  it('should derive scheme from android bundle id', () => {
    expect(getUrlScheme(mockConfig, 'android')).toBe('androidapp');
  });
});

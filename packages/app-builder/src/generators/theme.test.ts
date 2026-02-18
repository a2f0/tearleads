import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../types.js';
import { generateAppThemeCss } from './theme.js';

describe('generateAppThemeCss', () => {
  const mockConfig: AppConfig = {
    id: 'test-app',
    displayName: 'Test App',
    bundleIds: {
      ios: 'com.test.app',
      android: 'com.test.app',
      desktop: 'com.test.app'
    },
    platforms: ['ios'],
    features: ['notes'],
    api: {
      productionUrl: 'https://api.test.com/v1'
    },
    theme: {
      primaryColor: '#FF0000',
      backgroundColor: '#00FF00',
      accentColor: '#0000FF'
    }
  };

  it('should generate correct CSS variables', () => {
    const css = generateAppThemeCss(mockConfig);
    expect(css).toContain('--primary: #FF0000;');
    expect(css).toContain('--accent: #0000FF;');
    expect(css).toContain('--app-brand-background: #00FF00;');
    expect(css).toContain('--ring: #FF0000;');
  });

  it('should include app metadata in comments', () => {
    const css = generateAppThemeCss(mockConfig);
    expect(css).toContain('App: Test App (test-app)');
  });
});

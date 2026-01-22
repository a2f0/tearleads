import { describe, expect, it } from 'vitest';
import {
  LaserScreensaver,
  ScreensaverButton,
  ScreensaverProvider,
  useScreensaver
} from './index';

describe('screensaver exports', () => {
  it('exports LaserScreensaver', () => {
    expect(LaserScreensaver).toBeDefined();
  });

  it('exports ScreensaverButton', () => {
    expect(ScreensaverButton).toBeDefined();
  });

  it('exports ScreensaverProvider', () => {
    expect(ScreensaverProvider).toBeDefined();
  });

  it('exports useScreensaver', () => {
    expect(useScreensaver).toBeDefined();
  });
});

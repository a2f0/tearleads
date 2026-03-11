import { describe, expect, it, vi } from 'vitest';
import { loadDetectedLanguage, registerSettingsSyncedListener } from './i18n';

describe('i18n detected language loading', () => {
  it('loads detected supported language on init', async () => {
    const loadLanguageMock = vi.fn().mockResolvedValue(undefined);

    await loadDetectedLanguage('es', loadLanguageMock);

    expect(loadLanguageMock).toHaveBeenCalledWith('es');
  });

  it('skips settings listener when window is undefined', () => {
    const addEventListener = vi.fn();

    registerSettingsSyncedListener({
      addEventListener
    });
    expect(addEventListener).toHaveBeenCalledWith(
      'settings-synced',
      expect.any(Function)
    );

    addEventListener.mockClear();
    registerSettingsSyncedListener(undefined);
    expect(addEventListener).not.toHaveBeenCalled();
  });
});

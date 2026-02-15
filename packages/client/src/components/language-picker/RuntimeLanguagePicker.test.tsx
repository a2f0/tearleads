import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as i18nModule from '@/i18n';
import { RuntimeLanguagePicker } from './RuntimeLanguagePicker';

const DISPLAY_MODE_KEY = 'language-picker-display-mode';

function renderRuntimeLanguagePicker() {
  return render(
    <I18nextProvider i18n={i18nModule.i18n}>
      <RuntimeLanguagePicker />
      <button type="button">Outside</button>
    </I18nextProvider>
  );
}

describe('RuntimeLanguagePicker', () => {
  beforeEach(async () => {
    localStorage.removeItem(DISPLAY_MODE_KEY);
    await act(async () => {
      await i18nModule.i18n.changeLanguage('en');
    });
  });

  afterEach(async () => {
    localStorage.removeItem(DISPLAY_MODE_KEY);
    await act(async () => {
      await i18nModule.i18n.changeLanguage('en');
    });
    vi.restoreAllMocks();
  });

  it('renders a compact trigger with flag by default', () => {
    renderRuntimeLanguagePicker();

    const trigger = screen.getByTestId('runtime-language-picker-trigger');
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('🇺🇸');
  });

  it('renders abbreviation when display mode is set to abbreviation', () => {
    localStorage.setItem(DISPLAY_MODE_KEY, 'abbreviation');
    renderRuntimeLanguagePicker();

    const trigger = screen.getByTestId('runtime-language-picker-trigger');
    expect(trigger).toHaveTextContent('EN');
  });

  it('opens and shows all supported languages', async () => {
    const user = userEvent.setup();
    renderRuntimeLanguagePicker();

    await user.click(screen.getByTestId('runtime-language-picker-trigger'));

    expect(
      screen.getByTestId('runtime-language-picker-menu')
    ).toBeInTheDocument();
    for (const language of i18nModule.supportedLanguages) {
      expect(
        screen.getByTestId(`runtime-language-option-${language}`)
      ).toBeInTheDocument();
    }
  });

  it('closes when clicking outside', async () => {
    const user = userEvent.setup();
    renderRuntimeLanguagePicker();

    await user.click(screen.getByTestId('runtime-language-picker-trigger'));
    expect(
      screen.getByTestId('runtime-language-picker-menu')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(
      screen.queryByTestId('runtime-language-picker-menu')
    ).not.toBeInTheDocument();
  });

  it('loads and switches language at runtime when selecting an option', async () => {
    const user = userEvent.setup();
    const loadLanguageSpy = vi
      .spyOn(i18nModule, 'loadLanguage')
      .mockResolvedValue(undefined);
    const changeLanguageSpy = vi.spyOn(i18nModule.i18n, 'changeLanguage');

    renderRuntimeLanguagePicker();

    await user.click(screen.getByTestId('runtime-language-picker-trigger'));
    await user.click(screen.getByTestId('runtime-language-option-es'));

    expect(loadLanguageSpy).toHaveBeenCalledWith('es');
    expect(changeLanguageSpy).toHaveBeenCalledWith('es');
    expect(
      screen.queryByTestId('runtime-language-picker-menu')
    ).not.toBeInTheDocument();
  });

  it('toggles display mode from flag to abbreviation via context menu', async () => {
    const user = userEvent.setup();
    renderRuntimeLanguagePicker();

    const trigger = screen.getByTestId('runtime-language-picker-trigger');
    expect(trigger).toHaveTextContent('🇺🇸');

    await user.pointer({ keys: '[MouseRight]', target: trigger });

    const toggleButton = screen.getByTestId('toggle-display-mode');
    expect(toggleButton).toHaveTextContent('Show abbreviation');

    await user.click(toggleButton);

    expect(trigger).toHaveTextContent('EN');
    expect(localStorage.getItem(DISPLAY_MODE_KEY)).toBe('abbreviation');
  });

  it('toggles display mode from abbreviation to flag via context menu', async () => {
    localStorage.setItem(DISPLAY_MODE_KEY, 'abbreviation');
    const user = userEvent.setup();
    renderRuntimeLanguagePicker();

    const trigger = screen.getByTestId('runtime-language-picker-trigger');
    expect(trigger).toHaveTextContent('EN');

    await user.pointer({ keys: '[MouseRight]', target: trigger });

    const toggleButton = screen.getByTestId('toggle-display-mode');
    expect(toggleButton).toHaveTextContent('Show flag');

    await user.click(toggleButton);

    expect(trigger).toHaveTextContent('🇺🇸');
    expect(localStorage.getItem(DISPLAY_MODE_KEY)).toBe('flag');
  });

  it('closes menu when Escape is pressed', async () => {
    const user = userEvent.setup();
    renderRuntimeLanguagePicker();

    await user.click(screen.getByTestId('runtime-language-picker-trigger'));
    expect(
      screen.getByTestId('runtime-language-picker-menu')
    ).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(
      screen.queryByTestId('runtime-language-picker-menu')
    ).not.toBeInTheDocument();
  });

  it('keeps menu open when language loading fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(i18nModule, 'loadLanguage').mockRejectedValue(
      new Error('Load failed')
    );

    renderRuntimeLanguagePicker();

    await user.click(screen.getByTestId('runtime-language-picker-trigger'));
    await user.click(screen.getByTestId('runtime-language-option-es'));

    expect(
      screen.getByTestId('runtime-language-picker-menu')
    ).toBeInTheDocument();
  });

  it('defaults to flag when localStorage has invalid value', () => {
    localStorage.setItem(DISPLAY_MODE_KEY, 'invalid-value');
    renderRuntimeLanguagePicker();

    const trigger = screen.getByTestId('runtime-language-picker-trigger');
    expect(trigger).toHaveTextContent('🇺🇸');
  });

  it('handles localStorage errors gracefully on read', () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('localStorage error');
      });

    renderRuntimeLanguagePicker();

    const trigger = screen.getByTestId('runtime-language-picker-trigger');
    expect(trigger).toHaveTextContent('🇺🇸');

    getItemSpy.mockRestore();
  });

  it('handles localStorage errors gracefully on write', async () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('localStorage error');
      });
    const user = userEvent.setup();
    renderRuntimeLanguagePicker();

    const trigger = screen.getByTestId('runtime-language-picker-trigger');
    await user.pointer({ keys: '[MouseRight]', target: trigger });
    await user.click(screen.getByTestId('toggle-display-mode'));

    expect(trigger).toHaveTextContent('EN');

    setItemSpy.mockRestore();
  });
});

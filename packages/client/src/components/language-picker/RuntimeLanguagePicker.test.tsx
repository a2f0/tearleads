import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as i18nModule from '@/i18n';
import { RuntimeLanguagePicker } from './RuntimeLanguagePicker';

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
    await act(async () => {
      await i18nModule.i18n.changeLanguage('en');
    });
  });

  afterEach(async () => {
    await act(async () => {
      await i18nModule.i18n.changeLanguage('en');
    });
  });

  it('renders a compact trigger in the bottom-right actions area', () => {
    renderRuntimeLanguagePicker();

    const trigger = screen.getByTestId('runtime-language-picker-trigger');
    expect(trigger).toBeInTheDocument();
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
});

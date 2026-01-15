import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as i18nModule from '@/i18n';
import { LanguageSelector } from './LanguageSelector';

describe('LanguageSelector', () => {
  beforeEach(async () => {
    // Reset to English before each test
    await act(async () => {
      await i18nModule.i18n.changeLanguage('en');
    });
  });

  afterEach(async () => {
    // Clean up by resetting to English
    await act(async () => {
      await i18nModule.i18n.changeLanguage('en');
    });
  });

  const renderLanguageSelector = () => {
    return render(
      <I18nextProvider i18n={i18nModule.i18n}>
        <LanguageSelector />
      </I18nextProvider>
    );
  };

  it('renders the language selector container', () => {
    renderLanguageSelector();

    expect(
      screen.getByTestId('language-selector-container')
    ).toBeInTheDocument();
  });

  it('renders all supported language options', () => {
    renderLanguageSelector();

    for (const lang of i18nModule.supportedLanguages) {
      expect(screen.getByTestId(`language-option-${lang}`)).toBeInTheDocument();
    }
  });

  it('displays language names', () => {
    renderLanguageSelector();

    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('Español')).toBeInTheDocument();
    expect(screen.getByText('Українська')).toBeInTheDocument();
  });

  it('displays language flags', () => {
    renderLanguageSelector();

    expect(screen.getByText('🇺🇸')).toBeInTheDocument();
    expect(screen.getByText('🇪🇸')).toBeInTheDocument();
    expect(screen.getByText('🇺🇦')).toBeInTheDocument();
  });

  it('shows English as initially selected', () => {
    renderLanguageSelector();

    const englishOption = screen.getByTestId('language-option-en');
    expect(englishOption).toHaveAttribute('aria-pressed', 'true');
  });

  it('language options are clickable buttons', () => {
    renderLanguageSelector();

    const spanishOption = screen.getByTestId('language-option-es');
    expect(spanishOption.tagName).toBe('BUTTON');
    expect(spanishOption).toHaveAttribute('type', 'button');
  });

  it('renders section header', () => {
    renderLanguageSelector();

    expect(screen.getByText('Language')).toBeInTheDocument();
  });

  it('renders correct number of language options', () => {
    renderLanguageSelector();

    const buttons = screen
      .getByTestId('language-selector-container')
      .querySelectorAll('button');
    expect(buttons).toHaveLength(i18nModule.supportedLanguages.length);
  });

  it('loads and switches language when selecting a new option', async () => {
    const user = userEvent.setup();
    const loadLanguageSpy = vi
      .spyOn(i18nModule, 'loadLanguage')
      .mockResolvedValue(undefined);
    const changeLanguageSpy = vi.spyOn(i18nModule.i18n, 'changeLanguage');

    renderLanguageSelector();

    await user.click(screen.getByTestId('language-option-es'));

    expect(loadLanguageSpy).toHaveBeenCalledWith('es');
    expect(changeLanguageSpy).toHaveBeenCalledWith('es');
  });
});

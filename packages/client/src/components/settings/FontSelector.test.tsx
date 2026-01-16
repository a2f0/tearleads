import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import { FontSelector } from './FontSelector';

// Mock the useSettings hook
const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();

vi.mock('@/db/SettingsProvider', () => ({
  useSettings: () => ({
    getSetting: mockGetSetting,
    setSetting: mockSetSetting
  })
}));

function renderFontSelector() {
  return render(
    <I18nextProvider i18n={i18n}>
      <FontSelector />
    </I18nextProvider>
  );
}

describe('FontSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockReturnValue('system');
  });

  it('renders font selector title', () => {
    renderFontSelector();
    expect(screen.getByText('Font')).toBeInTheDocument();
  });

  it('renders font selector description', () => {
    renderFontSelector();
    expect(
      screen.getByText('Choose your preferred font style')
    ).toBeInTheDocument();
  });

  it('renders system and monospace buttons', () => {
    renderFontSelector();
    expect(screen.getByTestId('font-system-button')).toBeInTheDocument();
    expect(screen.getByTestId('font-monospace-button')).toBeInTheDocument();
  });

  it('shows system button as selected when font is system', () => {
    mockGetSetting.mockReturnValue('system');
    renderFontSelector();

    const systemButton = screen.getByTestId('font-system-button');
    const monospaceButton = screen.getByTestId('font-monospace-button');

    // Default variant indicates selected state
    expect(systemButton).not.toHaveClass('border');
    expect(monospaceButton).toHaveClass('border');
  });

  it('shows monospace button as selected when font is monospace', () => {
    mockGetSetting.mockReturnValue('monospace');
    renderFontSelector();

    const systemButton = screen.getByTestId('font-system-button');
    const monospaceButton = screen.getByTestId('font-monospace-button');

    // Outline variant indicates unselected state
    expect(systemButton).toHaveClass('border');
    expect(monospaceButton).not.toHaveClass('border');
  });

  it('calls setSetting with "system" when system button is clicked', async () => {
    mockGetSetting.mockReturnValue('monospace');
    const user = userEvent.setup();
    renderFontSelector();

    await user.click(screen.getByTestId('font-system-button'));

    expect(mockSetSetting).toHaveBeenCalledWith('font', 'system');
  });

  it('calls setSetting with "monospace" when monospace button is clicked', async () => {
    mockGetSetting.mockReturnValue('system');
    const user = userEvent.setup();
    renderFontSelector();

    await user.click(screen.getByTestId('font-monospace-button'));

    expect(mockSetSetting).toHaveBeenCalledWith('font', 'monospace');
  });

  it('gets the font setting value', () => {
    renderFontSelector();
    expect(mockGetSetting).toHaveBeenCalledWith('font');
  });
});

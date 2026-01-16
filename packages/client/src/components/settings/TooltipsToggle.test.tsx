import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import { TooltipsToggle } from './TooltipsToggle';

// Mock the useSettings hook
const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();

vi.mock('@/db/SettingsProvider', () => ({
  useSettings: () => ({
    getSetting: mockGetSetting,
    setSetting: mockSetSetting
  })
}));

function renderTooltipsToggle() {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipsToggle />
    </I18nextProvider>
  );
}

describe('TooltipsToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockReturnValue('enabled');
  });

  it('renders tooltips toggle title', () => {
    renderTooltipsToggle();
    expect(screen.getByText('Tooltips')).toBeInTheDocument();
  });

  it('renders tooltips toggle description', () => {
    renderTooltipsToggle();
    expect(
      screen.getByText('Show helpful hints when hovering over elements')
    ).toBeInTheDocument();
  });

  it('renders enabled and disabled buttons', () => {
    renderTooltipsToggle();
    expect(screen.getByTestId('tooltips-enabled-button')).toBeInTheDocument();
    expect(screen.getByTestId('tooltips-disabled-button')).toBeInTheDocument();
  });

  it('shows enabled button as selected when tooltips are enabled', () => {
    mockGetSetting.mockReturnValue('enabled');
    renderTooltipsToggle();

    const enabledButton = screen.getByTestId('tooltips-enabled-button');
    const disabledButton = screen.getByTestId('tooltips-disabled-button');

    // Default variant indicates selected state
    expect(enabledButton).not.toHaveClass('border');
    expect(disabledButton).toHaveClass('border');
  });

  it('shows disabled button as selected when tooltips are disabled', () => {
    mockGetSetting.mockReturnValue('disabled');
    renderTooltipsToggle();

    const enabledButton = screen.getByTestId('tooltips-enabled-button');
    const disabledButton = screen.getByTestId('tooltips-disabled-button');

    // Outline variant indicates unselected state
    expect(enabledButton).toHaveClass('border');
    expect(disabledButton).not.toHaveClass('border');
  });

  it('calls setSetting with "enabled" when enabled button is clicked', async () => {
    mockGetSetting.mockReturnValue('disabled');
    const user = userEvent.setup();
    renderTooltipsToggle();

    await user.click(screen.getByTestId('tooltips-enabled-button'));

    expect(mockSetSetting).toHaveBeenCalledWith('tooltips', 'enabled');
  });

  it('calls setSetting with "disabled" when disabled button is clicked', async () => {
    mockGetSetting.mockReturnValue('enabled');
    const user = userEvent.setup();
    renderTooltipsToggle();

    await user.click(screen.getByTestId('tooltips-disabled-button'));

    expect(mockSetSetting).toHaveBeenCalledWith('tooltips', 'disabled');
  });

  it('gets the tooltips setting value', () => {
    renderTooltipsToggle();
    expect(mockGetSetting).toHaveBeenCalledWith('tooltips');
  });
});

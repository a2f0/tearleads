import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import { IconBackgroundToggle } from './IconBackgroundToggle';

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();

vi.mock('@/db/SettingsProvider', () => ({
  useSettings: () => ({
    getSetting: mockGetSetting,
    setSetting: mockSetSetting
  })
}));

function renderIconBackgroundToggle() {
  return render(
    <I18nextProvider i18n={i18n}>
      <IconBackgroundToggle />
    </I18nextProvider>
  );
}

describe('IconBackgroundToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockReturnValue('colored');
  });

  it('renders icon background title', () => {
    renderIconBackgroundToggle();
    expect(screen.getByText('Icon backgrounds')).toBeInTheDocument();
  });

  it('renders icon background description', () => {
    renderIconBackgroundToggle();
    expect(
      screen.getByText('Choose whether icon tiles are colored or transparent')
    ).toBeInTheDocument();
  });

  it('renders colored and transparent buttons', () => {
    renderIconBackgroundToggle();
    expect(
      screen.getByTestId('icon-background-colored-button')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('icon-background-transparent-button')
    ).toBeInTheDocument();
  });

  it('shows colored button as selected when colored is active', () => {
    mockGetSetting.mockReturnValue('colored');
    renderIconBackgroundToggle();

    const coloredButton = screen.getByTestId('icon-background-colored-button');
    const transparentButton = screen.getByTestId(
      'icon-background-transparent-button'
    );

    expect(coloredButton).not.toHaveClass('border');
    expect(transparentButton).toHaveClass('border');
  });

  it('shows transparent button as selected when transparent is active', () => {
    mockGetSetting.mockReturnValue('transparent');
    renderIconBackgroundToggle();

    const coloredButton = screen.getByTestId('icon-background-colored-button');
    const transparentButton = screen.getByTestId(
      'icon-background-transparent-button'
    );

    expect(coloredButton).toHaveClass('border');
    expect(transparentButton).not.toHaveClass('border');
  });

  it('calls setSetting with colored when colored button is clicked', async () => {
    mockGetSetting.mockReturnValue('transparent');
    const user = userEvent.setup();
    renderIconBackgroundToggle();

    await user.click(screen.getByTestId('icon-background-colored-button'));

    expect(mockSetSetting).toHaveBeenCalledWith(
      'desktopIconBackground',
      'colored'
    );
  });

  it('calls setSetting with transparent when transparent button is clicked', async () => {
    mockGetSetting.mockReturnValue('colored');
    const user = userEvent.setup();
    renderIconBackgroundToggle();

    await user.click(
      screen.getByTestId('icon-background-transparent-button')
    );

    expect(mockSetSetting).toHaveBeenCalledWith(
      'desktopIconBackground',
      'transparent'
    );
  });

  it('gets the icon background setting value', () => {
    renderIconBackgroundToggle();
    expect(mockGetSetting).toHaveBeenCalledWith('desktopIconBackground');
  });
});

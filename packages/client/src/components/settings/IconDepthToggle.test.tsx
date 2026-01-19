import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import { IconDepthToggle } from './IconDepthToggle';

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();

vi.mock('@/db/SettingsProvider', () => ({
  useSettings: () => ({
    getSetting: mockGetSetting,
    setSetting: mockSetSetting
  })
}));

function renderIconDepthToggle() {
  return render(
    <I18nextProvider i18n={i18n}>
      <IconDepthToggle />
    </I18nextProvider>
  );
}

describe('IconDepthToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockReturnValue('embossed');
  });

  it('renders icon depth title', () => {
    renderIconDepthToggle();
    expect(screen.getByText('Icon depth')).toBeInTheDocument();
  });

  it('renders icon depth description', () => {
    renderIconDepthToggle();
    expect(
      screen.getByText('Choose whether icons look raised or inset')
    ).toBeInTheDocument();
  });

  it('renders embossed and debossed buttons', () => {
    renderIconDepthToggle();
    expect(
      screen.getByTestId('icon-depth-embossed-button')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('icon-depth-debossed-button')
    ).toBeInTheDocument();
  });

  it('shows embossed button as selected when embossed is active', () => {
    mockGetSetting.mockReturnValue('embossed');
    renderIconDepthToggle();

    const embossedButton = screen.getByTestId('icon-depth-embossed-button');
    const debossedButton = screen.getByTestId('icon-depth-debossed-button');

    expect(embossedButton).not.toHaveClass('border');
    expect(debossedButton).toHaveClass('border');
  });

  it('shows debossed button as selected when debossed is active', () => {
    mockGetSetting.mockReturnValue('debossed');
    renderIconDepthToggle();

    const embossedButton = screen.getByTestId('icon-depth-embossed-button');
    const debossedButton = screen.getByTestId('icon-depth-debossed-button');

    expect(embossedButton).toHaveClass('border');
    expect(debossedButton).not.toHaveClass('border');
  });

  it('calls setSetting with embossed when embossed button is clicked', async () => {
    mockGetSetting.mockReturnValue('debossed');
    const user = userEvent.setup();
    renderIconDepthToggle();

    await user.click(screen.getByTestId('icon-depth-embossed-button'));

    expect(mockSetSetting).toHaveBeenCalledWith('desktopIconDepth', 'embossed');
  });

  it('calls setSetting with debossed when debossed button is clicked', async () => {
    mockGetSetting.mockReturnValue('embossed');
    const user = userEvent.setup();
    renderIconDepthToggle();

    await user.click(screen.getByTestId('icon-depth-debossed-button'));

    expect(mockSetSetting).toHaveBeenCalledWith('desktopIconDepth', 'debossed');
  });

  it('gets the icon depth setting value', () => {
    renderIconDepthToggle();
    expect(mockGetSetting).toHaveBeenCalledWith('desktopIconDepth');
  });
});

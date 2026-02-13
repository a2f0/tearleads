import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import { WindowOpacityToggle } from './WindowOpacityToggle';

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();

vi.mock('@/db/SettingsProvider', () => ({
  useSettings: () => ({
    getSetting: mockGetSetting,
    setSetting: mockSetSetting
  })
}));

function renderWindowOpacityToggle() {
  return render(
    <I18nextProvider i18n={i18n}>
      <WindowOpacityToggle />
    </I18nextProvider>
  );
}

describe('WindowOpacityToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockReturnValue('translucent');
  });

  it('renders window opacity title', () => {
    renderWindowOpacityToggle();
    expect(screen.getByText('Window opacity')).toBeInTheDocument();
  });

  it('renders window opacity description', () => {
    renderWindowOpacityToggle();
    expect(
      screen.getByText(
        'Choose whether floating windows are translucent or fully opaque'
      )
    ).toBeInTheDocument();
  });

  it('renders translucent and opaque buttons', () => {
    renderWindowOpacityToggle();
    expect(
      screen.getByTestId('window-opacity-translucent-button')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('window-opacity-opaque-button')
    ).toBeInTheDocument();
  });

  it('shows translucent button as selected when translucent is active', () => {
    mockGetSetting.mockReturnValue('translucent');
    renderWindowOpacityToggle();

    const translucentButton = screen.getByTestId(
      'window-opacity-translucent-button'
    );
    const opaqueButton = screen.getByTestId('window-opacity-opaque-button');

    expect(translucentButton).not.toHaveClass('border');
    expect(opaqueButton).toHaveClass('border');
  });

  it('shows opaque button as selected when opaque is active', () => {
    mockGetSetting.mockReturnValue('opaque');
    renderWindowOpacityToggle();

    const translucentButton = screen.getByTestId(
      'window-opacity-translucent-button'
    );
    const opaqueButton = screen.getByTestId('window-opacity-opaque-button');

    expect(translucentButton).toHaveClass('border');
    expect(opaqueButton).not.toHaveClass('border');
  });

  it('calls setSetting with translucent when translucent button is clicked', async () => {
    mockGetSetting.mockReturnValue('opaque');
    const user = userEvent.setup();
    renderWindowOpacityToggle();

    await user.click(screen.getByTestId('window-opacity-translucent-button'));

    expect(mockSetSetting).toHaveBeenCalledWith('windowOpacity', 'translucent');
  });

  it('calls setSetting with opaque when opaque button is clicked', async () => {
    mockGetSetting.mockReturnValue('translucent');
    const user = userEvent.setup();
    renderWindowOpacityToggle();

    await user.click(screen.getByTestId('window-opacity-opaque-button'));

    expect(mockSetSetting).toHaveBeenCalledWith('windowOpacity', 'opaque');
  });

  it('gets the window opacity setting value', () => {
    renderWindowOpacityToggle();
    expect(mockGetSetting).toHaveBeenCalledWith('windowOpacity');
  });
});

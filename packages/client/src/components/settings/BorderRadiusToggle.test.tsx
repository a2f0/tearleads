import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import { BorderRadiusToggle } from './BorderRadiusToggle';

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();

vi.mock('@/db/SettingsProvider', () => ({
  useSettings: () => ({
    getSetting: mockGetSetting,
    setSetting: mockSetSetting
  })
}));

function renderBorderRadiusToggle() {
  return render(
    <I18nextProvider i18n={i18n}>
      <BorderRadiusToggle />
    </I18nextProvider>
  );
}

describe('BorderRadiusToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockReturnValue('rounded');
  });

  it('renders border radius title', () => {
    renderBorderRadiusToggle();
    expect(screen.getByText('Border radius')).toBeInTheDocument();
  });

  it('renders border radius description', () => {
    renderBorderRadiusToggle();
    expect(
      screen.getByText(
        'Choose whether UI and windows use rounded corners or right angles'
      )
    ).toBeInTheDocument();
  });

  it('renders rounded and square buttons', () => {
    renderBorderRadiusToggle();
    expect(
      screen.getByTestId('border-radius-rounded-button')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('border-radius-square-button')
    ).toBeInTheDocument();
  });

  it('shows rounded button as selected when rounded is active', () => {
    mockGetSetting.mockReturnValue('rounded');
    renderBorderRadiusToggle();

    const roundedButton = screen.getByTestId('border-radius-rounded-button');
    const squareButton = screen.getByTestId('border-radius-square-button');

    expect(roundedButton).not.toHaveClass('border');
    expect(squareButton).toHaveClass('border');
  });

  it('shows square button as selected when square is active', () => {
    mockGetSetting.mockReturnValue('square');
    renderBorderRadiusToggle();

    const roundedButton = screen.getByTestId('border-radius-rounded-button');
    const squareButton = screen.getByTestId('border-radius-square-button');

    expect(roundedButton).toHaveClass('border');
    expect(squareButton).not.toHaveClass('border');
  });

  it('calls setSetting with rounded when rounded button is clicked', async () => {
    mockGetSetting.mockReturnValue('square');
    const user = userEvent.setup();
    renderBorderRadiusToggle();

    await user.click(screen.getByTestId('border-radius-rounded-button'));

    expect(mockSetSetting).toHaveBeenCalledWith('borderRadius', 'rounded');
  });

  it('calls setSetting with square when square button is clicked', async () => {
    mockGetSetting.mockReturnValue('rounded');
    const user = userEvent.setup();
    renderBorderRadiusToggle();

    await user.click(screen.getByTestId('border-radius-square-button'));

    expect(mockSetSetting).toHaveBeenCalledWith('borderRadius', 'square');
  });

  it('gets the border radius setting value', () => {
    renderBorderRadiusToggle();
    expect(mockGetSetting).toHaveBeenCalledWith('borderRadius');
  });
});

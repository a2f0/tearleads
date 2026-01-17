import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PatternSelector } from './PatternSelector';

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();

vi.mock('@/db/SettingsProvider', () => ({
  useSettings: () => ({
    getSetting: mockGetSetting,
    setSetting: mockSetSetting
  })
}));

function renderPatternSelector() {
  return render(<PatternSelector />);
}

describe('PatternSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockReturnValue('solid');
  });

  it('renders pattern selector title', () => {
    renderPatternSelector();
    expect(screen.getByText('Desktop Pattern')).toBeInTheDocument();
  });

  it('renders pattern selector description', () => {
    renderPatternSelector();
    expect(
      screen.getByText('Choose a background pattern for the home screen')
    ).toBeInTheDocument();
  });

  it('renders all pattern options', () => {
    renderPatternSelector();
    expect(screen.getByTestId('pattern-option-solid')).toBeInTheDocument();
    expect(screen.getByTestId('pattern-option-honeycomb')).toBeInTheDocument();
    expect(screen.getByTestId('pattern-option-isometric')).toBeInTheDocument();
    expect(screen.getByTestId('pattern-option-triangles')).toBeInTheDocument();
    expect(screen.getByTestId('pattern-option-diamonds')).toBeInTheDocument();
  });

  it('shows solid option as selected when pattern is solid', () => {
    mockGetSetting.mockReturnValue('solid');
    renderPatternSelector();

    const solidOption = screen.getByTestId('pattern-option-solid');
    expect(solidOption).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows honeycomb option as selected when pattern is honeycomb', () => {
    mockGetSetting.mockReturnValue('honeycomb');
    renderPatternSelector();

    const honeycombOption = screen.getByTestId('pattern-option-honeycomb');
    expect(honeycombOption).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows isometric option as selected when pattern is isometric', () => {
    mockGetSetting.mockReturnValue('isometric');
    renderPatternSelector();

    const isometricOption = screen.getByTestId('pattern-option-isometric');
    expect(isometricOption).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows triangles option as selected when pattern is triangles', () => {
    mockGetSetting.mockReturnValue('triangles');
    renderPatternSelector();

    const trianglesOption = screen.getByTestId('pattern-option-triangles');
    expect(trianglesOption).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows diamonds option as selected when pattern is diamonds', () => {
    mockGetSetting.mockReturnValue('diamonds');
    renderPatternSelector();

    const diamondsOption = screen.getByTestId('pattern-option-diamonds');
    expect(diamondsOption).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls setSetting when honeycomb option is clicked', async () => {
    mockGetSetting.mockReturnValue('solid');
    const user = userEvent.setup();
    renderPatternSelector();

    await user.click(screen.getByTestId('pattern-option-honeycomb'));

    expect(mockSetSetting).toHaveBeenCalledWith('desktopPattern', 'honeycomb');
  });

  it('calls setSetting when isometric option is clicked', async () => {
    mockGetSetting.mockReturnValue('solid');
    const user = userEvent.setup();
    renderPatternSelector();

    await user.click(screen.getByTestId('pattern-option-isometric'));

    expect(mockSetSetting).toHaveBeenCalledWith('desktopPattern', 'isometric');
  });

  it('calls setSetting when triangles option is clicked', async () => {
    mockGetSetting.mockReturnValue('solid');
    const user = userEvent.setup();
    renderPatternSelector();

    await user.click(screen.getByTestId('pattern-option-triangles'));

    expect(mockSetSetting).toHaveBeenCalledWith('desktopPattern', 'triangles');
  });

  it('calls setSetting when diamonds option is clicked', async () => {
    mockGetSetting.mockReturnValue('solid');
    const user = userEvent.setup();
    renderPatternSelector();

    await user.click(screen.getByTestId('pattern-option-diamonds'));

    expect(mockSetSetting).toHaveBeenCalledWith('desktopPattern', 'diamonds');
  });

  it('calls setSetting when solid option is clicked', async () => {
    mockGetSetting.mockReturnValue('honeycomb');
    const user = userEvent.setup();
    renderPatternSelector();

    await user.click(screen.getByTestId('pattern-option-solid'));

    expect(mockSetSetting).toHaveBeenCalledWith('desktopPattern', 'solid');
  });

  it('gets the desktopPattern setting value', () => {
    renderPatternSelector();
    expect(mockGetSetting).toHaveBeenCalledWith('desktopPattern');
  });

  it('uses flex layout with horizontal scroll on mobile', () => {
    renderPatternSelector();
    const container = screen.getByTestId('pattern-selector-container');
    expect(container.className).toContain('flex');
    expect(container.className).toContain('overflow-x-auto');
    expect(container.className).toContain('md:overflow-visible');
  });

  it('applies responsive widths on pattern options', () => {
    renderPatternSelector();
    const patternOption = screen.getByTestId('pattern-option-solid');
    expect(patternOption.className).toContain('w-[100px]');
    expect(patternOption.className).toContain('shrink-0');
    expect(patternOption.className).toContain('md:w-[200px]');
  });

  it('renders pattern labels', () => {
    renderPatternSelector();
    expect(screen.getByText('Solid')).toBeInTheDocument();
    expect(screen.getByText('Honeycomb')).toBeInTheDocument();
    expect(screen.getByText('Isometric')).toBeInTheDocument();
    expect(screen.getByText('Triangles')).toBeInTheDocument();
    expect(screen.getByText('Diamonds')).toBeInTheDocument();
  });
});

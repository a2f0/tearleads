import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopBackground } from './index';

const mockGetSetting = vi.fn();

vi.mock('@tearleads/settings', () => ({
  useSettings: () => ({
    getSetting: mockGetSetting,
    setSetting: vi.fn()
  })
}));

describe('DesktopBackground', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when pattern is solid', () => {
    mockGetSetting.mockReturnValue('solid');
    const { container } = render(<DesktopBackground />);
    expect(container.firstChild).toBeNull();
  });

  it('renders honeycomb SVG when pattern is honeycomb', () => {
    mockGetSetting.mockReturnValue('honeycomb');
    const { container } = render(<DesktopBackground />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();

    const pattern = container.querySelector('pattern#honeycomb-bg');
    expect(pattern).toBeInTheDocument();
  });

  it('renders isometric SVG when pattern is isometric', () => {
    mockGetSetting.mockReturnValue('isometric');
    const { container } = render(<DesktopBackground />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();

    const pattern = container.querySelector('pattern#isometric-bg');
    expect(pattern).toBeInTheDocument();
  });

  it('reads pattern from settings', () => {
    mockGetSetting.mockReturnValue('diamonds');
    render(<DesktopBackground />);

    expect(mockGetSetting).toHaveBeenCalledWith('desktopPattern');
  });

  it('passes className to the base component', () => {
    mockGetSetting.mockReturnValue('honeycomb');
    const { container } = render(
      <DesktopBackground className="custom-class" />
    );

    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('custom-class');
  });
});

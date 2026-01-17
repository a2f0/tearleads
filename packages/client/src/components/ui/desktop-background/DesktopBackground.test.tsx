import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopBackground } from './DesktopBackground';

const mockGetSetting = vi.fn();

vi.mock('@/db/SettingsProvider', () => ({
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

  it('renders triangles SVG when pattern is triangles', () => {
    mockGetSetting.mockReturnValue('triangles');
    const { container } = render(<DesktopBackground />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();

    const pattern = container.querySelector('pattern#triangles-bg');
    expect(pattern).toBeInTheDocument();
  });

  it('renders diamonds SVG when pattern is diamonds', () => {
    mockGetSetting.mockReturnValue('diamonds');
    const { container } = render(<DesktopBackground />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();

    const pattern = container.querySelector('pattern#diamonds-bg');
    expect(pattern).toBeInTheDocument();
  });

  it('has aria-hidden attribute for accessibility', () => {
    mockGetSetting.mockReturnValue('honeycomb');
    const { container } = render(<DesktopBackground />);

    const wrapper = container.firstElementChild;
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
  });

  it('has pointer-events-none class to allow click-through', () => {
    mockGetSetting.mockReturnValue('honeycomb');
    const { container } = render(<DesktopBackground />);

    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('pointer-events-none');
  });

  it('has absolute positioning to cover parent', () => {
    mockGetSetting.mockReturnValue('isometric');
    const { container } = render(<DesktopBackground />);

    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('absolute');
    expect(wrapper?.className).toContain('inset-0');
  });
});

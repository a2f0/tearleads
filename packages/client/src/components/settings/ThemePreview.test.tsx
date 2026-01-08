import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemePreview } from './ThemePreview';

describe('ThemePreview', () => {
  it.each([
    'light',
    'dark',
    'tokyo-night'
  ] as const)('renders %s theme preview', (theme) => {
    render(<ThemePreview theme={theme} />);
    const labels = {
      light: 'Light',
      dark: 'Dark',
      'tokyo-night': 'Tokyo Night'
    };
    expect(screen.getByText(labels[theme])).toBeInTheDocument();
  });

  it.each([
    ['light', '#ffffff'],
    ['dark', '#0a0a0a'],
    ['tokyo-night', '#24283b']
  ] as const)('renders with correct background color for %s theme', (theme, color) => {
    const { container } = render(<ThemePreview theme={theme} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveStyle({ backgroundColor: color });
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemePreview } from './ThemePreview';

describe('ThemePreview', () => {
  const themes: Array<'light' | 'dark' | 'tokyo-night'> = [
    'light',
    'dark',
    'tokyo-night'
  ];

  it.each(themes)('renders %s theme preview', (theme) => {
    render(<ThemePreview theme={theme} />);
    const labels = {
      light: 'Light',
      dark: 'Dark',
      'tokyo-night': 'Tokyo Night'
    };
    expect(screen.getByText(labels[theme])).toBeInTheDocument();
  });

  const themeColors: Array<{
    theme: 'light' | 'dark' | 'tokyo-night';
    color: string;
  }> = [
    { theme: 'light', color: '#ffffff' },
    { theme: 'dark', color: '#0a0a0a' },
    { theme: 'tokyo-night', color: '#24283b' }
  ];

  it.each(themeColors)('renders with correct background color for %s theme', ({
    theme,
    color
  }) => {
    const { container } = render(<ThemePreview theme={theme} />);
    const wrapper = container.firstElementChild;
    expect(wrapper).not.toBeNull();
    if (!wrapper) {
      throw new Error('Missing theme preview wrapper.');
    }
    expect(wrapper).toHaveStyle({ backgroundColor: color });
  });
});

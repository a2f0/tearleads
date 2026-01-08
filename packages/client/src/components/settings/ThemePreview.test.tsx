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

  it('renders with correct background color for light theme', () => {
    const { container } = render(<ThemePreview theme="light" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveStyle({ backgroundColor: '#ffffff' });
  });

  it('renders with correct background color for dark theme', () => {
    const { container } = render(<ThemePreview theme="dark" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveStyle({ backgroundColor: '#0a0a0a' });
  });

  it('renders with correct background color for tokyo-night theme', () => {
    const { container } = render(<ThemePreview theme="tokyo-night" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveStyle({ backgroundColor: '#24283b' });
  });
});

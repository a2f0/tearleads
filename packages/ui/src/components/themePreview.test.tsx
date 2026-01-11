import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemePreview } from './themePreview.js';

describe('ThemePreview', () => {
  it('renders light theme preview', () => {
    render(<ThemePreview theme="light" />);
    expect(screen.getByText('Light')).toBeInTheDocument();
  });

  it('renders dark theme preview', () => {
    render(<ThemePreview theme="dark" />);
    expect(screen.getByText('Dark')).toBeInTheDocument();
  });

  it('renders tokyo-night theme preview', () => {
    render(<ThemePreview theme="tokyo-night" />);
    expect(screen.getByText('Tokyo Night')).toBeInTheDocument();
  });

  it('applies correct background color for light theme', () => {
    const { container } = render(<ThemePreview theme="light" />);
    const preview = container.firstChild as HTMLElement;
    expect(preview).toHaveStyle({ backgroundColor: '#ffffff' });
  });

  it('applies correct background color for dark theme', () => {
    const { container } = render(<ThemePreview theme="dark" />);
    const preview = container.firstChild as HTMLElement;
    expect(preview).toHaveStyle({ backgroundColor: '#0a0a0a' });
  });

  it('applies correct background color for tokyo-night theme', () => {
    const { container } = render(<ThemePreview theme="tokyo-night" />);
    const preview = container.firstChild as HTMLElement;
    expect(preview).toHaveStyle({ backgroundColor: '#24283b' });
  });
});

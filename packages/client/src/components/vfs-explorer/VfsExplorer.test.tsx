import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VfsExplorer } from './VfsExplorer';

describe('VfsExplorer', () => {
  it('renders tree panel and details panel', () => {
    render(<VfsExplorer />);
    expect(screen.getByText('Folders')).toBeInTheDocument();
    expect(
      screen.getByText('Select a folder to view its contents')
    ).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<VfsExplorer className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('renders with list view mode by default', () => {
    render(<VfsExplorer />);
    expect(
      screen.getByText('Select a folder to view its contents')
    ).toBeInTheDocument();
  });

  it('renders with table view mode when specified', () => {
    render(<VfsExplorer viewMode="table" />);
    expect(
      screen.getByText('Select a folder to view its contents')
    ).toBeInTheDocument();
  });
});

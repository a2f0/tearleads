import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VfsDetailsPanel } from './VfsDetailsPanel';

describe('VfsDetailsPanel', () => {
  it('shows placeholder when no folder is selected', () => {
    render(<VfsDetailsPanel folderId={null} />);
    expect(
      screen.getByText('Select a folder to view its contents')
    ).toBeInTheDocument();
  });

  it('shows item count when folder is selected', () => {
    render(<VfsDetailsPanel folderId="1" />);
    expect(screen.getByText('5 items')).toBeInTheDocument();
  });

  it('renders items in list view by default', () => {
    render(<VfsDetailsPanel folderId="1" />);
    expect(screen.getByText('Subfolder')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Meeting Notes')).toBeInTheDocument();
  });

  it('renders items in table view when specified', () => {
    render(<VfsDetailsPanel folderId="1" viewMode="table" />);

    expect(
      screen.getByRole('columnheader', { name: 'Name' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Type' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Created' })
    ).toBeInTheDocument();
  });

  it('shows folder items with correct types', () => {
    render(<VfsDetailsPanel folderId="1" viewMode="table" />);

    expect(screen.getByText('folder')).toBeInTheDocument();
    expect(screen.getByText('contact')).toBeInTheDocument();
    expect(screen.getByText('note')).toBeInTheDocument();
    expect(screen.getByText('file')).toBeInTheDocument();
    expect(screen.getByText('photo')).toBeInTheDocument();
  });

  it('shows all mock item names', () => {
    render(<VfsDetailsPanel folderId="1" />);

    expect(screen.getByText('Subfolder')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Meeting Notes')).toBeInTheDocument();
    expect(screen.getByText('document.pdf')).toBeInTheDocument();
    expect(screen.getByText('vacation.jpg')).toBeInTheDocument();
  });

  it('displays plural item text for multiple items', () => {
    render(<VfsDetailsPanel folderId="1" />);
    expect(screen.getByText('5 items')).toBeInTheDocument();
  });
});

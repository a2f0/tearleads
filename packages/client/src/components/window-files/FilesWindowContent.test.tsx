import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FilesWindowContentRef } from './FilesWindowContent';
import { FilesWindowContent } from './FilesWindowContent';

// Mock the FilesList component
vi.mock('@/components/files', () => ({
  FilesList: ({
    showDeleted,
    showHeader,
    showDropzone
  }: {
    showDeleted: boolean;
    showHeader: boolean;
    showDropzone: boolean;
  }) => (
    <div
      data-testid="files-list"
      data-show-deleted={showDeleted}
      data-show-header={showHeader}
      data-show-dropzone={showDropzone}
    >
      Files List Mock
    </div>
  )
}));

describe('FilesWindowContent', () => {
  it('renders FilesList component', () => {
    render(<FilesWindowContent showDeleted={false} showDropzone={true} />);
    expect(screen.getByTestId('files-list')).toBeInTheDocument();
  });

  it('passes showDeleted prop to FilesList', () => {
    render(<FilesWindowContent showDeleted={true} showDropzone={true} />);
    expect(screen.getByTestId('files-list')).toHaveAttribute(
      'data-show-deleted',
      'true'
    );
  });

  it('passes showHeader=false to FilesList', () => {
    render(<FilesWindowContent showDeleted={false} showDropzone={true} />);
    expect(screen.getByTestId('files-list')).toHaveAttribute(
      'data-show-header',
      'false'
    );
  });

  it('passes showDropzone to FilesList', () => {
    render(<FilesWindowContent showDeleted={false} showDropzone={false} />);
    expect(screen.getByTestId('files-list')).toHaveAttribute(
      'data-show-dropzone',
      'false'
    );
  });

  it('wraps content in scrollable container', () => {
    render(<FilesWindowContent showDeleted={false} showDropzone={true} />);
    const container = screen.getByTestId('files-list').parentElement;
    expect(container).toHaveClass('overflow-auto');
    expect(container).toHaveClass('h-full');
  });

  it('exposes uploadFiles via ref', () => {
    const ref = createRef<FilesWindowContentRef>();
    render(
      <FilesWindowContent ref={ref} showDeleted={false} showDropzone={true} />
    );

    expect(ref.current).not.toBeNull();
    expect(ref.current?.uploadFiles).toBeDefined();
    expect(typeof ref.current?.uploadFiles).toBe('function');
  });

  it('uploadFiles can be called without error', () => {
    const ref = createRef<FilesWindowContentRef>();
    render(
      <FilesWindowContent ref={ref} showDeleted={false} showDropzone={true} />
    );

    const file = new File(['test'], 'test.txt', { type: 'text/plain' });
    // Should not throw
    expect(() => ref.current?.uploadFiles([file])).not.toThrow();
  });
});

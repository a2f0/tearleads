import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FileDetailInfoPanel } from './FileDetailInfoPanel';

describe('FileDetailInfoPanel', () => {
  it('renders file metadata', () => {
    render(
      <FileDetailInfoPanel
        category="document"
        file={{
          id: 'file-1',
          name: 'notes.txt',
          size: 1024,
          mimeType: 'text/plain',
          uploadDate: new Date('2024-01-01T00:00:00.000Z'),
          storagePath: '/files/notes.txt'
        }}
      />
    );

    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('text/plain')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
  });
});

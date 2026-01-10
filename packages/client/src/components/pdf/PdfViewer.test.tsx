import { ThemeProvider } from '@rapid/ui';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfViewer } from './PdfViewer';

const mockOnLoadSuccess = vi.fn();
const mockOnLoadError = vi.fn();

vi.mock('react-pdf', () => ({
  Document: ({
    children,
    onLoadSuccess,
    onLoadError,
    loading
  }: {
    children: React.ReactNode;
    onLoadSuccess?: (data: { numPages: number }) => void;
    onLoadError?: (error: Error) => void;
    loading?: React.ReactNode;
    file: string;
  }) => {
    if (onLoadSuccess) mockOnLoadSuccess.mockImplementation(onLoadSuccess);
    if (onLoadError) mockOnLoadError.mockImplementation(onLoadError);
    return (
      <div data-testid="mock-document">
        {loading}
        {children}
      </div>
    );
  },
  Page: ({
    pageNumber,
    scale,
    loading
  }: {
    pageNumber: number;
    scale: number;
    loading?: React.ReactNode;
    className?: string;
    renderTextLayer?: boolean;
    renderAnnotationLayer?: boolean;
  }) => (
    <div data-testid="mock-page" data-page={pageNumber} data-scale={scale}>
      {loading}
      Page {pageNumber} at {scale}x
    </div>
  ),
  pdfjs: {
    GlobalWorkerOptions: {
      workerSrc: ''
    }
  }
}));

const TEST_PDF_DATA = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e
]);

function renderPdfViewer(data: Uint8Array = TEST_PDF_DATA) {
  return render(
    <ThemeProvider>
      <PdfViewer data={data} />
    </ThemeProvider>
  );
}

describe('PdfViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial render', () => {
    it('renders the pdf viewer container', () => {
      renderPdfViewer();
      expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument();
    });

    it('shows loading state initially', () => {
      renderPdfViewer();
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('renders document and page components', () => {
      renderPdfViewer();
      expect(screen.getByTestId('mock-document')).toBeInTheDocument();
      expect(screen.getByTestId('mock-page')).toBeInTheDocument();
    });
  });

  describe('page navigation', () => {
    beforeEach(async () => {
      renderPdfViewer();
      await act(async () => {
        mockOnLoadSuccess({ numPages: 5 });
      });
    });

    it('shows page info after load', async () => {
      await waitFor(() => {
        expect(screen.getByTestId('pdf-page-info')).toHaveTextContent(
          'Page 1 of 5'
        );
      });
    });

    it('navigates to next page', async () => {
      const user = userEvent.setup();
      await waitFor(() => {
        expect(screen.getByTestId('pdf-page-info')).toHaveTextContent(
          'Page 1 of 5'
        );
      });

      await user.click(screen.getByTestId('pdf-next-page'));

      expect(screen.getByTestId('pdf-page-info')).toHaveTextContent(
        'Page 2 of 5'
      );
    });

    it('navigates to previous page', async () => {
      const user = userEvent.setup();
      await waitFor(() => {
        expect(screen.getByTestId('pdf-page-info')).toHaveTextContent(
          'Page 1 of 5'
        );
      });

      await user.click(screen.getByTestId('pdf-next-page'));
      await user.click(screen.getByTestId('pdf-next-page'));
      expect(screen.getByTestId('pdf-page-info')).toHaveTextContent(
        'Page 3 of 5'
      );

      await user.click(screen.getByTestId('pdf-prev-page'));
      expect(screen.getByTestId('pdf-page-info')).toHaveTextContent(
        'Page 2 of 5'
      );
    });

    it('disables previous button on first page', async () => {
      await waitFor(() => {
        expect(screen.getByTestId('pdf-page-info')).toHaveTextContent(
          'Page 1 of 5'
        );
      });

      expect(screen.getByTestId('pdf-prev-page')).toBeDisabled();
    });

    it('disables next button on last page', async () => {
      const user = userEvent.setup();
      await waitFor(() => {
        expect(screen.getByTestId('pdf-page-info')).toHaveTextContent(
          'Page 1 of 5'
        );
      });

      for (let i = 0; i < 4; i++) {
        await user.click(screen.getByTestId('pdf-next-page'));
      }

      expect(screen.getByTestId('pdf-page-info')).toHaveTextContent(
        'Page 5 of 5'
      );
      expect(screen.getByTestId('pdf-next-page')).toBeDisabled();
    });
  });

  describe('zoom controls', () => {
    beforeEach(async () => {
      renderPdfViewer();
      await act(async () => {
        mockOnLoadSuccess({ numPages: 1 });
      });
    });

    it('shows initial zoom level of 100%', () => {
      expect(screen.getByTestId('pdf-zoom-level')).toHaveTextContent('100%');
    });

    it('zooms in when zoom in button clicked', async () => {
      const user = userEvent.setup();

      await user.click(screen.getByTestId('pdf-zoom-in'));

      expect(screen.getByTestId('pdf-zoom-level')).toHaveTextContent('125%');
      expect(screen.getByTestId('mock-page')).toHaveAttribute(
        'data-scale',
        '1.25'
      );
    });

    it('zooms out when zoom out button clicked', async () => {
      const user = userEvent.setup();

      await user.click(screen.getByTestId('pdf-zoom-out'));

      expect(screen.getByTestId('pdf-zoom-level')).toHaveTextContent('75%');
      expect(screen.getByTestId('mock-page')).toHaveAttribute(
        'data-scale',
        '0.75'
      );
    });

    it('disables zoom out at minimum scale (50%)', async () => {
      const user = userEvent.setup();

      // Zoom out twice to reach 50%
      await user.click(screen.getByTestId('pdf-zoom-out'));
      await user.click(screen.getByTestId('pdf-zoom-out'));

      expect(screen.getByTestId('pdf-zoom-level')).toHaveTextContent('50%');
      expect(screen.getByTestId('pdf-zoom-out')).toBeDisabled();
    });

    it('disables zoom in at maximum scale (300%)', async () => {
      const user = userEvent.setup();

      // Zoom in 8 times to reach 300%
      for (let i = 0; i < 8; i++) {
        await user.click(screen.getByTestId('pdf-zoom-in'));
      }

      expect(screen.getByTestId('pdf-zoom-level')).toHaveTextContent('300%');
      expect(screen.getByTestId('pdf-zoom-in')).toBeDisabled();
    });
  });

  describe('error handling', () => {
    it('displays error message when PDF fails to load', async () => {
      renderPdfViewer();
      await act(async () => {
        mockOnLoadError(new Error('Failed to parse PDF'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('pdf-error')).toBeInTheDocument();
        expect(screen.getByText('Failed to parse PDF')).toBeInTheDocument();
      });
    });

    it('displays generic error when error has no message', async () => {
      renderPdfViewer();
      await act(async () => {
        mockOnLoadError(new Error(''));
      });

      await waitFor(() => {
        expect(screen.getByTestId('pdf-error')).toBeInTheDocument();
        expect(screen.getByText('Failed to load PDF')).toBeInTheDocument();
      });
    });
  });

  describe('accessibility', () => {
    beforeEach(async () => {
      renderPdfViewer();
      await act(async () => {
        mockOnLoadSuccess({ numPages: 5 });
      });
    });

    it('has accessible labels for navigation buttons', () => {
      expect(screen.getByLabelText('Previous page')).toBeInTheDocument();
      expect(screen.getByLabelText('Next page')).toBeInTheDocument();
    });

    it('has accessible labels for zoom buttons', () => {
      expect(screen.getByLabelText('Zoom in')).toBeInTheDocument();
      expect(screen.getByLabelText('Zoom out')).toBeInTheDocument();
    });
  });
});

import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MermaidRenderer } from './MermaidRenderer';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>mock diagram</svg>' })
  }
}));

describe('MermaidRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the mermaid diagram after loading', async () => {
    await act(async () => {
      render(<MermaidRenderer code="graph TD; A-->B" theme="light" />);
    });

    await waitFor(() => {
      expect(screen.queryByText('Loading diagram...')).not.toBeInTheDocument();
    });

    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('renders error state when mermaid fails', async () => {
    const mermaid = await import('mermaid');
    vi.mocked(mermaid.default.render).mockRejectedValueOnce(
      new Error('Invalid syntax')
    );

    await act(async () => {
      render(<MermaidRenderer code="invalid mermaid" theme="light" />);
    });

    await waitFor(() => {
      expect(
        screen.getByText('Failed to render Mermaid diagram')
      ).toBeInTheDocument();
    });

    expect(screen.getByText('Invalid syntax')).toBeInTheDocument();
  });

  it('passes correct theme to mermaid render', async () => {
    const mermaid = await import('mermaid');

    await act(async () => {
      render(<MermaidRenderer code="graph TD; A-->B" theme="dark" />);
    });

    await waitFor(() => {
      expect(mermaid.default.render).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"theme": "dark"')
      );
    });
  });

  it('uses neutral theme for light mode', async () => {
    const mermaid = await import('mermaid');

    await act(async () => {
      render(<MermaidRenderer code="graph TD; A-->B" theme="light" />);
    });

    await waitFor(() => {
      expect(mermaid.default.render).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"theme": "neutral"')
      );
    });
  });
});

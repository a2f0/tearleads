import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MermaidRenderer } from './MermaidRenderer';

describe('MermaidRenderer', () => {
  let previousGetBBox: PropertyDescriptor | undefined;

  beforeEach(() => {
    previousGetBBox = Object.getOwnPropertyDescriptor(
      SVGElement.prototype,
      'getBBox'
    );

    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: vi.fn(() => ({ x: 0, y: 0, width: 100, height: 50 }))
    });
  });

  afterEach(() => {
    if (previousGetBBox) {
      Object.defineProperty(SVGElement.prototype, 'getBBox', previousGetBBox);
      return;
    }

    Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
  });

  it('shows loading before diagram resolves', () => {
    render(<MermaidRenderer code="graph TD; A-->B;" theme="light" />);

    expect(screen.getByText('Loading diagram...')).toBeInTheDocument();
  });

  it('renders svg output when mermaid succeeds', async () => {
    const { container } = render(
      <MermaidRenderer code="graph TD; A-->B;" theme="dark" />
    );

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    expect(screen.queryByText('Loading diagram...')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Failed to render Mermaid diagram')
    ).not.toBeInTheDocument();
  });

  it('shows error details when mermaid render fails', async () => {
    render(<MermaidRenderer code="this is not mermaid syntax" theme="light" />);

    expect(
      await screen.findByText('Failed to render Mermaid diagram')
    ).toBeInTheDocument();
    expect(screen.getByText('this is not mermaid syntax')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownWithToc } from './MarkdownWithToc';

vi.mock('@uiw/react-md-editor', () => ({
  default: {
    Markdown: ({ source }: { source: string }) => (
      <div data-testid="markdown">{source.slice(0, 20)}</div>
    )
  }
}));

vi.mock('@tearleads/window-manager', () => ({
  WindowSidebar: ({
    children,
    'data-testid': testId
  }: {
    children: React.ReactNode;
    'data-testid'?: string;
  }) => <div data-testid={testId}>{children}</div>,
  useWindowSidebar: () => ({ closeSidebar: vi.fn(), isMobileDrawer: false })
}));

describe('MarkdownWithToc', () => {
  it('renders a table of contents sidebar and content scroll area', () => {
    render(
      <MarkdownWithToc
        markdownColorMode="light"
        source={'# Intro\n## Installation\n## Usage'}
      />
    );

    expect(screen.getByTestId('markdown-toc-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-content-scroll')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Table of contents' })
    ).toBeInTheDocument();
  });

  it('creates stable heading links and ignores fenced code headings', () => {
    render(
      <MarkdownWithToc
        markdownColorMode="dark"
        source={`# Intro
## Details
\`\`\`bash
# Not a heading
\`\`\`
## Details`}
      />
    );

    expect(screen.getByRole('link', { name: 'Intro' })).toHaveAttribute(
      'href',
      '#intro'
    );
    const detailsLinks = screen.getAllByRole('link', { name: 'Details' });
    expect(detailsLinks[0]).toHaveAttribute('href', '#details');
    expect(detailsLinks[1]).toHaveAttribute('href', '#details-1');
    expect(
      screen.queryByRole('link', { name: 'Not a heading' })
    ).not.toBeInTheDocument();
  });

  it('preserves non-tag less-than characters in headings', () => {
    render(
      <MarkdownWithToc markdownColorMode="light" source={'## Value is < 5'} />
    );

    expect(screen.getByRole('link', { name: 'Value is < 5' })).toHaveAttribute(
      'href',
      '#value-is-5'
    );
  });

  it('hides toc sidebar when markdown has no headings', () => {
    render(
      <MarkdownWithToc markdownColorMode="light" source={'plain text only'} />
    );

    expect(
      screen.queryByTestId('markdown-toc-sidebar')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('markdown-content-scroll')).toBeInTheDocument();
  });
});

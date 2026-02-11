import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownWithToc } from './MarkdownWithToc';

vi.mock('@uiw/react-md-editor', () => ({
  default: {
    Markdown: ({ source }: { source: string }) => (
      <div data-testid="markdown">{source.slice(0, 20)}</div>
    )
  }
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
    expect(
      screen.getByRole('separator', {
        name: 'Resize table of contents sidebar'
      })
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

  it('hides toc sidebar when markdown has no headings', () => {
    render(
      <MarkdownWithToc markdownColorMode="light" source={'plain text only'} />
    );

    expect(
      screen.queryByTestId('markdown-toc-sidebar')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('markdown-content-scroll')).toBeInTheDocument();
  });

  it('resizes toc sidebar from keyboard', async () => {
    const user = userEvent.setup();

    render(
      <MarkdownWithToc
        markdownColorMode="light"
        source={'# Intro\n## Installation\n## Usage'}
      />
    );

    const sidebar = screen.getByTestId('markdown-toc-sidebar');
    const resizeHandle = screen.getByRole('separator', {
      name: 'Resize table of contents sidebar'
    });

    expect(sidebar).toHaveStyle({ width: '220px' });

    resizeHandle.focus();
    await user.keyboard('{ArrowRight}');
    expect(sidebar).toHaveStyle({ width: '230px' });

    await user.keyboard('{ArrowLeft}');
    expect(sidebar).toHaveStyle({ width: '220px' });
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ComplianceDocView } from './ComplianceDocView';

vi.mock('@tearleads/compliance', () => ({
  getComplianceDocument: (frameworkId: string, docPath: string | undefined) => {
    if (frameworkId === 'SOC2' && (!docPath || docPath === 'POLICY_INDEX.md')) {
      return {
        frameworkId: 'SOC2',
        docPath: 'POLICY_INDEX.md',
        title: 'Policy Index',
        source: '# Policy Index\n\nThis is the policy index.'
      };
    }
    if (frameworkId === 'SOC2' && docPath === 'OTHER_DOC.md') {
      return {
        frameworkId: 'SOC2',
        docPath: 'OTHER_DOC.md',
        title: 'Other Doc',
        source: '# Other Doc\n\nThis is another doc.'
      };
    }
    return null;
  },
  getFrameworkDocuments: (frameworkId: string) => {
    if (frameworkId === 'SOC2') {
      return [
        {
          frameworkId: 'SOC2',
          docPath: 'POLICY_INDEX.md',
          routePath: '/compliance/SOC2/POLICY_INDEX.md',
          title: 'Policy Index'
        },
        {
          frameworkId: 'SOC2',
          docPath: 'OTHER_DOC.md',
          routePath: '/compliance/SOC2/OTHER_DOC.md',
          title: 'Other Doc'
        }
      ];
    }
    return [];
  },
  getFrameworkLabel: (frameworkId: string) => {
    if (frameworkId === 'SOC2') return 'SOC 2';
    if (frameworkId === 'HIPAA') return 'HIPAA';
    return frameworkId;
  },
  resolveComplianceLink: () => null
}));

vi.mock('@tearleads/ui', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  useTheme: () => ({ resolvedTheme: 'dark' })
}));

vi.mock('@tearleads/backups', () => ({
  MarkdownWithToc: ({ source }: { source: string }) => (
    <div data-testid="markdown-content">{source}</div>
  )
}));

describe('ComplianceDocView', () => {
  it('renders framework label and description', () => {
    render(
      <ComplianceDocView
        frameworkId="SOC2"
        docPath={null}
        onDocSelect={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'SOC 2' })).toBeInTheDocument();
    expect(
      screen.getByText(/Browse framework documentation/)
    ).toBeInTheDocument();
  });

  it('renders document navigation', () => {
    render(
      <ComplianceDocView
        frameworkId="SOC2"
        docPath={null}
        onDocSelect={vi.fn()}
      />
    );

    expect(screen.getByText('Documents')).toBeInTheDocument();
    expect(screen.getByText('Policy Index')).toBeInTheDocument();
    expect(screen.getByText('Other Doc')).toBeInTheDocument();
  });

  it('renders markdown content for default document', () => {
    render(
      <ComplianceDocView
        frameworkId="SOC2"
        docPath={null}
        onDocSelect={vi.fn()}
      />
    );

    expect(screen.getByTestId('markdown-content')).toHaveTextContent(
      'Policy Index'
    );
  });

  it('renders markdown content for specific document', () => {
    render(
      <ComplianceDocView
        frameworkId="SOC2"
        docPath="OTHER_DOC.md"
        onDocSelect={vi.fn()}
      />
    );

    expect(screen.getByTestId('markdown-content')).toHaveTextContent(
      'Other Doc'
    );
  });

  it('calls onDocSelect when a document is clicked', async () => {
    const user = userEvent.setup();
    const onDocSelect = vi.fn();
    render(
      <ComplianceDocView
        frameworkId="SOC2"
        docPath={null}
        onDocSelect={onDocSelect}
      />
    );

    await user.click(screen.getByText('Other Doc'));

    expect(onDocSelect).toHaveBeenCalledWith('OTHER_DOC.md');
  });

  it('shows not found message for empty framework', () => {
    render(
      <ComplianceDocView
        frameworkId="UNKNOWN"
        docPath={null}
        onDocSelect={vi.fn()}
      />
    );

    expect(
      screen.getByText('This compliance framework was not found.')
    ).toBeInTheDocument();
  });
});

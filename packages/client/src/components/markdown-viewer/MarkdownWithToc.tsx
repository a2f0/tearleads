import MDEditor from '@uiw/react-md-editor';
import { type HTMLAttributes, isValidElement, type ReactNode } from 'react';

interface TocHeading {
  id: string;
  level: number;
  text: string;
}

interface MarkdownWithTocProps {
  markdownColorMode: 'light' | 'dark';
  source: string;
}

function createSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return slug || 'section';
}

function createSlugger() {
  const used = new Map<string, number>();

  return (value: string): string => {
    const base = createSlug(value);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

function stripMarkdownInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/<\/?[^>]+>/g, '');
}

function extractHeadings(source: string): TocHeading[] {
  const getHeadingId = createSlugger();
  const headings: TocHeading[] = [];
  const lines = source.split(/\r?\n/);
  let inFence = false;
  let fenceChar = '';
  let fenceLength = 0;

  for (const line of lines) {
    const fenceStartMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fenceStartMatch) {
      const marker = fenceStartMatch[2];
      if (!marker) {
        continue;
      }

      if (!inFence) {
        inFence = true;
        fenceChar = marker[0] ?? '';
        fenceLength = marker.length;
      } else if (
        marker[0] === fenceChar &&
        marker.length >= fenceLength &&
        line.trimStart().startsWith(fenceChar.repeat(fenceLength))
      ) {
        inFence = false;
      }

      continue;
    }

    if (inFence) {
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!headingMatch) {
      continue;
    }

    const headingToken = headingMatch[1];
    const headingValue = headingMatch[2];
    if (!headingToken || !headingValue) {
      continue;
    }

    const rawText = headingValue.replace(/\s+#+\s*$/, '').trim();
    const text = stripMarkdownInline(rawText).trim();
    if (!text) {
      continue;
    }

    headings.push({
      id: getHeadingId(text),
      level: headingToken.length,
      text
    });
  }

  return headings;
}

function extractNodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(extractNodeText).join('');
  }

  if (
    isValidElement<{ alt?: string; children?: ReactNode }>(node) &&
    node.type === 'img' &&
    typeof node.props.alt === 'string'
  ) {
    return node.props.alt;
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractNodeText(node.props.children);
  }

  return '';
}

type HeadingProps = HTMLAttributes<HTMLHeadingElement> & {
  children?: ReactNode;
};

export function MarkdownWithToc({
  source,
  markdownColorMode
}: MarkdownWithTocProps) {
  const headings = extractHeadings(source);
  const hasToc = headings.length > 0;
  const getRenderedHeadingId = createSlugger();

  function createHeading(level: 1 | 2 | 3 | 4 | 5 | 6) {
    const Tag = `h${level}` as const;

    return function Heading({ children, ...props }: HeadingProps) {
      return (
        <Tag
          id={getRenderedHeadingId(extractNodeText(children).trim())}
          {...props}
        >
          {children}
        </Tag>
      );
    };
  }

  const markdownComponents = {
    h1: createHeading(1),
    h2: createHeading(2),
    h3: createHeading(3),
    h4: createHeading(4),
    h5: createHeading(5),
    h6: createHeading(6)
  };

  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
      <div
        className={`grid h-full min-h-0 ${
          hasToc ? 'grid-cols-[220px_minmax(0,1fr)]' : 'grid-cols-1'
        }`}
      >
        {hasToc && (
          <aside
            className="min-h-0 border-r bg-muted/20"
            data-testid="markdown-toc-sidebar"
          >
            <div className="h-full overflow-y-auto p-3">
              <h3 className="mb-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                On This Page
              </h3>
              <nav aria-label="Table of contents" className="space-y-1">
                {headings.map((heading) => (
                  <a
                    key={heading.id}
                    href={`#${heading.id}`}
                    className="block rounded px-2 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
                    style={{ paddingLeft: `${(heading.level - 1) * 10 + 8}px` }}
                  >
                    {heading.text}
                  </a>
                ))}
              </nav>
            </div>
          </aside>
        )}

        <div
          className="min-h-0 overflow-y-auto p-4"
          data-testid="markdown-content-scroll"
        >
          <div data-color-mode={markdownColorMode}>
            <MDEditor.Markdown
              source={source}
              components={markdownComponents}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

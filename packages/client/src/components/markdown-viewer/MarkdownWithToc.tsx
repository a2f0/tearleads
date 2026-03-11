import {
  useWindowSidebar,
  WindowSidebar
} from '@tearleads/window-manager';
import MDEditor from '@uiw/react-md-editor';
import {
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  isValidElement,
  type ReactNode,
  useCallback,
  useState
} from 'react';
import { MermaidRenderer } from './MermaidRenderer';

// one-component-per-file: allow - markdown heading renderers are intentionally inlined for MDEditor component overrides.
interface TocHeading {
  id: string;
  level: number;
  text: string;
}

interface MarkdownWithTocProps {
  markdownColorMode: 'light' | 'dark';
  source: string;
  linkComponent?: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => ReactNode;
  sidebarOpen?: boolean | undefined;
  onSidebarOpenChange?: ((open: boolean) => void) | undefined;
}

const DEFAULT_TOC_WIDTH = 220;
const MIN_TOC_WIDTH = 160;
const MAX_TOC_WIDTH = 420;

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

function isMarkdownWhitespace(char: string | undefined): boolean {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\r' ||
    char === '\f'
  );
}

function collapseMarkdownLinks(text: string): string {
  let collapsed = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    const isImagePrefix = char === '!' && text[index + 1] === '[';
    const labelStart = isImagePrefix ? index + 1 : index;

    if (text[labelStart] === '[') {
      const labelEnd = text.indexOf(']', labelStart + 1);
      if (labelEnd > labelStart && text[labelEnd + 1] === '(') {
        const linkEnd = text.indexOf(')', labelEnd + 2);
        if (linkEnd > labelEnd) {
          collapsed += text.slice(labelStart + 1, labelEnd);
          index = linkEnd;
          continue;
        }
      }
    }

    collapsed += char;
  }

  return collapsed;
}

function isLikelyTagStart(char: string | undefined): boolean {
  if (char === undefined) {
    return false;
  }

  return (
    (char >= 'a' && char <= 'z') ||
    (char >= 'A' && char <= 'Z') ||
    char === '!' ||
    char === '/' ||
    char === '?'
  );
}

function removeHtmlTags(value: string): string {
  let result = '';
  let tagStartIndex = -1;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? '';

    if (char === '<' && tagStartIndex === -1) {
      if (isLikelyTagStart(value[index + 1])) {
        tagStartIndex = index;
      } else {
        result += char;
      }
      continue;
    }

    if (char === '>' && tagStartIndex !== -1) {
      tagStartIndex = -1;
      continue;
    }

    if (tagStartIndex === -1) {
      result += char;
    }
  }

  if (tagStartIndex !== -1) {
    result += value.slice(tagStartIndex);
  }

  return result;
}

function stripMarkdownInline(text: string): string {
  const withoutLinks = collapseMarkdownLinks(text);
  let withoutFormatting = '';
  let inInlineCode = false;

  for (const char of withoutLinks) {
    if (char === '`') {
      inInlineCode = !inInlineCode;
      continue;
    }

    if (!inInlineCode && (char === '*' || char === '_' || char === '~')) {
      continue;
    }

    withoutFormatting += char;
  }

  return removeHtmlTags(withoutFormatting);
}

function getFenceMarker(line: string): string | null {
  let index = 0;
  while (index < line.length && isMarkdownWhitespace(line[index])) {
    index += 1;
  }

  const markerChar = line[index];
  if (markerChar !== '`' && markerChar !== '~') {
    return null;
  }

  let markerEnd = index;
  while (line[markerEnd] === markerChar) {
    markerEnd += 1;
  }

  const markerLength = markerEnd - index;
  if (markerLength < 3) {
    return null;
  }

  return markerChar.repeat(markerLength);
}

function trimHeadingClosingHashes(value: string): string {
  let end = value.length;
  while (end > 0 && isMarkdownWhitespace(value[end - 1])) {
    end -= 1;
  }

  let hashStart = end;
  while (hashStart > 0 && value[hashStart - 1] === '#') {
    hashStart -= 1;
  }

  if (
    hashStart < end &&
    hashStart > 0 &&
    isMarkdownWhitespace(value[hashStart - 1])
  ) {
    end = hashStart - 1;
    while (end > 0 && isMarkdownWhitespace(value[end - 1])) {
      end -= 1;
    }
  }

  return value.slice(0, end);
}

function parseAtxHeading(line: string): { level: number; text: string } | null {
  if (!line.startsWith('#')) {
    return null;
  }

  let level = 0;
  while (level < line.length && line[level] === '#') {
    level += 1;
  }

  if (level < 1 || level > 6) {
    return null;
  }

  if (line[level] === '#' || !isMarkdownWhitespace(line[level])) {
    return null;
  }

  let textStart = level;
  while (textStart < line.length && isMarkdownWhitespace(line[textStart])) {
    textStart += 1;
  }

  const headingText = trimHeadingClosingHashes(line.slice(textStart).trim());
  if (headingText.length === 0) {
    return null;
  }

  return { level, text: headingText };
}

function extractHeadings(source: string): TocHeading[] {
  const getHeadingId = createSlugger();
  const headings: TocHeading[] = [];
  const lines = source.split('\n');
  let inFence = false;
  let fenceChar = '';
  let fenceLength = 0;

  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const marker = getFenceMarker(line);
    if (marker !== null) {
      const markerChar = marker[0] ?? '';

      if (!inFence) {
        inFence = true;
        fenceChar = markerChar;
        fenceLength = marker.length;
      } else if (markerChar === fenceChar && marker.length >= fenceLength) {
        inFence = false;
      }

      continue;
    }

    if (inFence) {
      continue;
    }

    const heading = parseAtxHeading(line);
    if (!heading) {
      continue;
    }

    const text = stripMarkdownInline(heading.text).trim();
    if (!text) {
      continue;
    }

    headings.push({
      id: getHeadingId(text),
      level: heading.level,
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

// one-component-per-file: allow - TocLink is an intentionally inlined helper for WindowSidebar mobile drawer close-on-click.
function TocLink({ heading }: { heading: TocHeading }) {
  const { closeSidebar } = useWindowSidebar();

  const handleClick = useCallback(() => {
    closeSidebar();
  }, [closeSidebar]);

  return (
    <a
      href={`#${heading.id}`}
      className="block rounded px-2 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
      style={{ paddingLeft: `${(heading.level - 1) * 10 + 8}px` }}
      onClick={handleClick}
    >
      {heading.text}
    </a>
  );
}

export function MarkdownWithToc({
  source,
  markdownColorMode,
  linkComponent,
  sidebarOpen = false,
  onSidebarOpenChange
}: MarkdownWithTocProps) {
  const [tocWidth, setTocWidth] = useState(DEFAULT_TOC_WIDTH);
  const headings = extractHeadings(source);
  const hasToc = headings.length > 0;
  const getRenderedHeadingId = createSlugger();

  const handleSidebarOpenChange = useCallback(
    (open: boolean) => {
      onSidebarOpenChange?.(open);
    },
    [onSidebarOpenChange]
  );

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
    h6: createHeading(6),
    code: ({
      children,
      className
    }: HTMLAttributes<HTMLElement> & { children?: ReactNode }) => {
      const match = /language-(\w+)/.exec(className ?? '');
      const language = match?.[1];

      if (language === 'mermaid' && typeof children === 'string') {
        return <MermaidRenderer code={children} theme={markdownColorMode} />;
      }

      return <code className={className}>{children}</code>;
    },
    ...(linkComponent
      ? {
          a: ({
            children,
            ...props
          }: AnchorHTMLAttributes<HTMLAnchorElement>) =>
            linkComponent({ children, ...props })
        }
      : {})
  };

  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
      <div className="flex h-full min-h-0">
        {hasToc && (
          <WindowSidebar
            width={tocWidth}
            onWidthChange={setTocWidth}
            open={sidebarOpen}
            onOpenChange={handleSidebarOpenChange}
            ariaLabel="Resize table of contents sidebar"
            minWidth={MIN_TOC_WIDTH}
            maxWidth={MAX_TOC_WIDTH}
            data-testid="markdown-toc-sidebar"
          >
            <div className="h-full overflow-y-auto p-3">
              <h3 className="mb-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                On This Page
              </h3>
              <nav aria-label="Table of contents" className="space-y-1">
                {headings.map((heading) => (
                  <TocLink key={heading.id} heading={heading} />
                ))}
              </nav>
            </div>
          </WindowSidebar>
        )}

        <div
          className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4"
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

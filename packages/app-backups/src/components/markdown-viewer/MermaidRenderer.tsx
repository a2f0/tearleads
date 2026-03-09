import { useEffect, useId, useRef, useState } from 'react';

interface MermaidRendererProps {
  code: string;
  theme: 'light' | 'dark';
}

export function MermaidRenderer({ code, theme }: MermaidRendererProps) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = await import('mermaid');
        mermaid.default.initialize({ startOnLoad: false });

        const themeValue = theme === 'dark' ? 'dark' : 'neutral';
        const themedCode = `%%{init: { "theme": "${themeValue}", "fontFamily": "inherit", "securityLevel": "strict" } }%%\n${code}`;
        const uniqueId = `mermaid-graph-${id.replace(/:/g, '-')}`;
        const { svg: renderedSvg } = await mermaid.default.render(
          uniqueId,
          themedCode
        );

        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to render diagram'
          );
          setSvg(null);
        }
      }
    }

    void render();

    return () => {
      cancelled = true;
    };
  }, [code, id, theme]);

  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-destructive text-sm">
        <p className="font-medium">Failed to render Mermaid diagram</p>
        <p className="mt-1 text-muted-foreground">{error}</p>
        <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center justify-center rounded-md border bg-muted/50 p-4">
        <span className="text-muted-foreground text-sm">
          Loading diagram...
        </span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-4 flex justify-center overflow-x-auto"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid SVG output is safe
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

import { Loader2 } from 'lucide-react';
import { lazy, Suspense } from 'react';

const MarkdownEditor = lazy(() =>
  import('./MarkdownEditor').then((m) => ({ default: m.MarkdownEditor }))
);

interface LazyMarkdownEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  colorMode: 'light' | 'dark';
  hideToolbar?: boolean;
}

function MarkdownEditorFallback() {
  return (
    <div
      className="flex h-full items-center justify-center rounded-lg border bg-muted/50"
      data-testid="markdown-editor-fallback"
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export function LazyMarkdownEditor(props: LazyMarkdownEditorProps) {
  return (
    <Suspense fallback={<MarkdownEditorFallback />}>
      <MarkdownEditor {...props} />
    </Suspense>
  );
}

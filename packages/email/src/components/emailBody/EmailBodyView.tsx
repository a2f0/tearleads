import { Loader2 } from 'lucide-react';
import type {
  EmailBodyViewMode,
  ParsedEmailBody
} from '../../types/emailBody.js';

interface EmailBodyViewProps {
  body: ParsedEmailBody | null;
  loading: boolean;
  error: string | null;
  viewMode: EmailBodyViewMode;
  onViewModeChange: (mode: EmailBodyViewMode) => void;
}

export function EmailBodyView({
  body,
  loading,
  error,
  viewMode,
  onViewModeChange
}: EmailBodyViewProps) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <div className="p-3 text-destructive text-sm">{error}</div>;
  }

  if (!body) {
    return (
      <div className="p-3 text-muted-foreground text-sm italic">
        No email body available
      </div>
    );
  }

  const hasHtml = body.html !== null;
  const hasText = body.text !== null;
  const showToggle = hasHtml && hasText;

  return (
    <div className="flex h-full flex-col">
      {showToggle && (
        <div className="flex gap-1 border-b px-3 py-1.5">
          <button
            type="button"
            onClick={() => onViewModeChange('html')}
            className={`rounded px-2 py-0.5 text-xs ${
              viewMode === 'html'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            HTML
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('text')}
            className={`rounded px-2 py-0.5 text-xs ${
              viewMode === 'text'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            Text
          </button>
        </div>
      )}
      <div className="flex-1 overflow-auto p-3">
        {viewMode === 'html' && body.html ? (
          <div
            className="prose prose-sm max-w-none"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is sanitized by DOMPurify in parseMimeMessage
            dangerouslySetInnerHTML={{ __html: body.html }}
          />
        ) : (
          <pre className="whitespace-pre-wrap text-sm">{body.text ?? ''}</pre>
        )}
      </div>
    </div>
  );
}

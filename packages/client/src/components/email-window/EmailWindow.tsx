import { Loader2, Mail } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { API_BASE_URL } from '@/lib/api';
import { type EmailItem, formatEmailDate, formatEmailSize } from '@/lib/email';
import type { ViewMode } from './EmailWindowMenuBar';
import { EmailWindowMenuBar } from './EmailWindowMenuBar';

interface EmailWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function EmailWindow({
  id,
  onClose,
  onMinimize,
  onFocus,
  zIndex,
  initialDimensions
}: EmailWindowProps) {
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/emails`);
      if (!response.ok) {
        throw new Error(`Failed to fetch emails: ${response.statusText}`);
      }
      const data = await response.json();
      setEmails(data.emails ?? []);
    } catch (err) {
      console.error('Failed to fetch emails:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const selectedEmail = emails.find((e) => e.id === selectedEmailId);

  return (
    <FloatingWindow
      id={id}
      title={selectedEmail ? 'Email' : 'Inbox'}
      onClose={onClose}
      onMinimize={onMinimize}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={550}
      defaultHeight={450}
      minWidth={400}
      minHeight={300}
    >
      <div className="flex h-full flex-col">
        {!selectedEmailId && (
          <EmailWindowMenuBar
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onRefresh={fetchEmails}
            onClose={onClose}
          />
        )}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-4 text-destructive text-sm">{error}</div>
          ) : selectedEmailId && selectedEmail ? (
            <div className="flex h-full flex-col">
              <div className="border-b p-3">
                <button
                  type="button"
                  onClick={() => setSelectedEmailId(null)}
                  className="mb-2 text-muted-foreground text-xs hover:text-foreground"
                >
                  &larr; Back to Inbox
                </button>
                <h2 className="font-medium text-sm">
                  {selectedEmail.subject || '(No Subject)'}
                </h2>
                <p className="text-muted-foreground text-xs">
                  From: {selectedEmail.from}
                </p>
                <p className="text-muted-foreground text-xs">
                  To: {selectedEmail.to.join(', ')}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatEmailDate(selectedEmail.receivedAt)} ·{' '}
                  {formatEmailSize(selectedEmail.size)}
                </p>
              </div>
              <div className="flex-1 overflow-auto p-3">
                <p className="text-muted-foreground text-sm italic">
                  Email body parsing coming soon...
                </p>
              </div>
            </div>
          ) : emails.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Mail className="h-8 w-8" />
              <p className="text-sm">No emails yet</p>
            </div>
          ) : viewMode === 'list' ? (
            <div className="h-full overflow-auto">
              {emails.map((email) => (
                <button
                  key={email.id}
                  type="button"
                  onClick={() => setSelectedEmailId(email.id)}
                  className="flex w-full items-start gap-3 border-b p-3 text-left transition-colors hover:bg-muted/50"
                >
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">
                      {email.subject || '(No Subject)'}
                    </p>
                    <p className="truncate text-muted-foreground text-xs">
                      {email.from}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {formatEmailDate(email.receivedAt)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="h-full overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-medium">Subject</th>
                    <th className="p-2 text-left font-medium">From</th>
                    <th className="p-2 text-left font-medium">Date</th>
                    <th className="p-2 text-right font-medium">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {emails.map((email) => (
                    <tr
                      key={email.id}
                      onClick={() => setSelectedEmailId(email.id)}
                      className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                    >
                      <td className="max-w-[200px] truncate p-2">
                        {email.subject || '(No Subject)'}
                      </td>
                      <td className="max-w-[150px] truncate p-2 text-muted-foreground">
                        {email.from}
                      </td>
                      <td className="whitespace-nowrap p-2 text-muted-foreground">
                        {formatEmailDate(email.receivedAt)}
                      </td>
                      <td className="p-2 text-right text-muted-foreground">
                        {formatEmailSize(email.size)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}

import { Loader2, Mail } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { RefreshButton } from '@/components/ui/refresh-button';
import { API_BASE_URL } from '@/lib/api';
import { getAuthHeaderValue } from '@/lib/auth-storage';
import { type EmailItem, formatEmailDate, formatEmailSize } from '@/lib/email';

export function Email() {
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHasFetched(true);

    try {
      const authHeader = getAuthHeaderValue();
      const headers = authHeader ? { Authorization: authHeader } : undefined;
      const response = await fetch(`${API_BASE_URL}/emails`, { headers });
      if (!response.ok) {
        throw new Error(`Failed to fetch emails: ${response.statusText}`);
      }
      const data = await response.json();
      setEmails(data.emails ?? []);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch emails:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasFetched) {
      fetchEmails();
    }
  }, [hasFetched, fetchEmails]);

  const selectedEmail = emails.find((email) => email.id === selectedEmailId);

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mail className="h-8 w-8 text-muted-foreground" />
            <h1 className="font-bold text-2xl tracking-tight">Email</h1>
          </div>
          <RefreshButton onClick={fetchEmails} loading={loading} />
        </div>
      </div>

      {error && (
        <div className="whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {loading && emails.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading emails...
        </div>
      ) : emails.length === 0 && hasFetched && !error ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border p-8 text-muted-foreground">
          <Mail className="h-12 w-12" />
          <p>No emails yet</p>
          <p className="text-center text-xs">
            Send an email to your configured address to see it here
          </p>
        </div>
      ) : selectedEmail ? (
        <div className="flex-1 rounded-lg border">
          <div className="border-b p-4">
            <button
              type="button"
              onClick={() => setSelectedEmailId(null)}
              className="mb-2 text-muted-foreground text-xs hover:text-foreground"
            >
              &larr; Back to Email
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
          <div className="flex-1 overflow-auto p-4">
            <p className="text-muted-foreground text-sm italic">
              Email body parsing coming soon...
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 rounded-lg border" data-testid="email-list">
          <div className="h-full overflow-auto">
            {emails.map((email) => (
              <button
                key={email.id}
                type="button"
                onClick={() => setSelectedEmailId(email.id)}
                className="flex w-full items-start gap-3 border-b p-4 text-left transition-colors last:border-b-0 hover:bg-muted/50"
              >
                <Mail className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {email.subject || '(No Subject)'}
                  </p>
                  <p className="truncate text-muted-foreground text-sm">
                    From: {email.from}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {formatEmailDate(email.receivedAt)} ·{' '}
                    {formatEmailSize(email.size)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

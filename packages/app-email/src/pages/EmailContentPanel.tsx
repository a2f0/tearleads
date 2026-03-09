import { Loader2, Mail } from 'lucide-react';
import { type EmailItem, formatEmailDate, formatEmailSize } from '../lib';

interface EmailContentPanelProps {
  loading: boolean;
  error: string | null;
  emails: EmailItem[];
  hasFetched: boolean;
  isListBackedFolder: boolean;
  selectedFolderName: string;
  selectedEmail: EmailItem | undefined;
  onSelectEmail: (id: string | null) => void;
}

export function EmailContentPanel({
  loading,
  error,
  emails,
  hasFetched,
  isListBackedFolder,
  selectedFolderName,
  selectedEmail,
  onSelectEmail
}: EmailContentPanelProps) {
  if (loading && emails.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading emails...
      </div>
    );
  }

  if (!isListBackedFolder) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Mail className="h-12 w-12" />
        <p>No emails in {selectedFolderName}</p>
      </div>
    );
  }

  if (emails.length === 0 && hasFetched && !error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Mail className="h-12 w-12" />
        <p>No emails yet</p>
        <p className="text-center text-xs">
          Send an email to your configured address to see it here
        </p>
      </div>
    );
  }

  if (selectedEmail) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b p-4">
          <button
            type="button"
            onClick={() => onSelectEmail(null)}
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
    );
  }

  return (
    <div className="h-full overflow-auto" data-testid="email-list">
      {emails.map((email) => (
        <button
          key={email.id}
          type="button"
          onClick={() => onSelectEmail(email.id)}
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
  );
}

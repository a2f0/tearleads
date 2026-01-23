import type { Session } from '@rapid/shared';
import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function SessionList() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      setError(null);
      const response = await api.auth.getSessions();
      setSessions(response.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  const handleDelete = useCallback(async (sessionId: string) => {
    setDeletingId(sessionId);
    try {
      await api.auth.deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session');
    } finally {
      setDeletingId(null);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="text-muted-foreground text-sm">Loading sessions...</div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <div className="rounded-md bg-destructive/10 p-3 text-destructive text-sm">
          {error}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchSessions()}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="text-muted-foreground text-sm">No active sessions</div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => (
        <div
          key={session.id}
          className="flex items-center justify-between rounded-md border p-3"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-muted-foreground text-xs">
                {session.ipAddress}
              </span>
              {session.isCurrent && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs">
                  Current
                </span>
              )}
            </div>
            <div className="text-muted-foreground text-xs">
              Created {formatRelativeTime(session.createdAt)}
              {' · '}
              Active {formatRelativeTime(session.lastActiveAt)}
            </div>
          </div>
          {!session.isCurrent && (
            <Button
              variant="ghost"
              size="icon"
              className="ml-2 h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => void handleDelete(session.id)}
              disabled={deletingId === session.id}
              aria-label="Revoke session"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

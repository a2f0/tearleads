import { LogOut, Mail } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { LoginForm } from '@/components/auth';
import { SessionList } from '@/components/sessions';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';

function formatTimeRemaining(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

interface SyncProps {
  showBackLink?: boolean;
}

export function Sync({ showBackLink = true }: SyncProps) {
  const {
    isAuthenticated,
    user,
    isLoading,
    logout,
    tokenExpiresAt,
    getTokenTimeRemaining
  } = useAuth();
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);
  const [emailDomain, setEmailDomain] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setTimeRemaining(null);
      return;
    }

    const updateTimeRemaining = () => {
      const remaining = getTokenTimeRemaining();
      if (remaining !== null && remaining > 0) {
        setTimeRemaining(formatTimeRemaining(remaining));
      } else {
        setTimeRemaining('Expired');
      }
    };

    updateTimeRemaining();
    const interval = setInterval(updateTimeRemaining, 1000);
    return () => clearInterval(interval);
  }, [isAuthenticated, getTokenTimeRemaining]);

  useEffect(() => {
    if (!isAuthenticated) {
      setEmailDomain(null);
      return;
    }

    api.ping.get().then((data) => {
      setEmailDomain(data.emailDomain ?? null);
    });
  }, [isAuthenticated]);

  const handleLogout = useCallback(async () => {
    await logout();
  }, [logout]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          {showBackLink && (
            <BackLink defaultTo="/" defaultLabel="Back to Home" />
          )}
          <h1 className="font-bold text-2xl tracking-tight">Sync</h1>
        </div>
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (isAuthenticated && user) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          {showBackLink && (
            <BackLink defaultTo="/" defaultLabel="Back to Home" />
          )}
          <h1 className="font-bold text-2xl tracking-tight">Sync</h1>
        </div>

        <div className="rounded-lg border p-4">
          <div className="space-y-4">
            <div>
              <p className="font-medium">Logged in as</p>
              <p className="text-muted-foreground text-sm">{user.email}</p>
            </div>

            {emailDomain && (
              <div>
                <p className="font-medium">Email address</p>
                <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
                  <Mail className="h-3.5 w-3.5" />
                  {user.id}@{emailDomain}
                </p>
              </div>
            )}

            <div>
              <p className="font-medium">Token expires</p>
              <p className="text-muted-foreground text-sm">
                {timeRemaining === 'Expired' ? (
                  <span className="text-destructive">{timeRemaining}</span>
                ) : (
                  <>
                    in {timeRemaining}
                    {tokenExpiresAt && (
                      <span className="ml-1">
                        ({tokenExpiresAt.toLocaleTimeString()})
                      </span>
                    )}
                  </>
                )}
              </p>
            </div>

            <Button onClick={handleLogout} variant="outline" className="w-full">
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <div className="space-y-4">
            <div>
              <p className="font-medium">Active Sessions</p>
              <p className="text-muted-foreground text-sm">
                Manage your active sessions across devices
              </p>
            </div>

            <SessionList />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
        <h1 className="font-bold text-2xl tracking-tight">Sync</h1>
      </div>

      <LoginForm
        title="Login"
        description="Sign in to sync your data across devices"
      />
    </div>
  );
}

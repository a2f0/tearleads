import { BackLink, Button } from '@tearleads/ui';
import { LogOut, Mail } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getSyncAuthDependencies } from '../../lib/authDependencies';

type AuthMode = 'login' | 'register';

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
  const { t } = useTranslation('sync');
  const dependencies = getSyncAuthDependencies();
  const LoginForm = dependencies?.LoginForm;
  const RegisterForm = dependencies?.RegisterForm;
  const SessionList = dependencies?.SessionList;
  const auth = dependencies?.useAuth();
  const isAuthenticated = auth?.isAuthenticated ?? false;
  const user = auth?.user ?? null;
  const isLoading = auth?.isLoading ?? false;
  const logout = auth?.logout;
  const tokenExpiresAt = auth?.tokenExpiresAt ?? null;
  const getTokenTimeRemaining = auth?.getTokenTimeRemaining;
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);
  const [emailDomain, setEmailDomain] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>(
    dependencies?.initialAuthMode ?? 'login'
  );

  useEffect(() => {
    if (!isAuthenticated) {
      setTimeRemaining(null);
      return;
    }

    const updateTimeRemaining = () => {
      const remaining = getTokenTimeRemaining?.() ?? null;
      if (remaining !== null && remaining > 0) {
        setTimeRemaining(formatTimeRemaining(remaining));
      } else {
        setTimeRemaining(t('expired'));
      }
    };

    updateTimeRemaining();
    const interval = setInterval(updateTimeRemaining, 1000);
    return () => clearInterval(interval);
  }, [isAuthenticated, getTokenTimeRemaining, t]);

  // Fetch email domain on mount (for registration form hint)
  useEffect(() => {
    if (!dependencies) {
      return;
    }

    dependencies
      .ping()
      .then((data) => {
        setEmailDomain(data.emailDomain ?? null);
      })
      .catch(() => {
        setEmailDomain(null);
      });
  }, [dependencies]);

  const handleLogout = useCallback(async () => {
    if (logout) {
      await logout();
    }
  }, [logout]);

  if (!dependencies || !LoginForm || !RegisterForm || !SessionList) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          {showBackLink && (
            <BackLink defaultTo="/" defaultLabel="Back to Home" />
          )}
          <h1 className="font-bold text-2xl tracking-tight">{t('sync')}</h1>
        </div>
        <div className="text-muted-foreground text-sm">
          Sync is not configured.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          {showBackLink && (
            <BackLink defaultTo="/" defaultLabel="Back to Home" />
          )}
          <h1 className="font-bold text-2xl tracking-tight">{t('sync')}</h1>
        </div>
        <div className="text-muted-foreground">{t('loading')}</div>
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
          <h1 className="font-bold text-2xl tracking-tight">{t('sync')}</h1>
        </div>

        <div className="rounded-lg border p-4">
          <div className="space-y-4">
            <div>
              <p className="font-medium">{t('loggedInAs')}</p>
              <p className="text-muted-foreground text-sm">{user.email}</p>
            </div>

            {emailDomain && (
              <div>
                <p className="font-medium">{t('emailAddress')}</p>
                <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
                  <Mail className="h-3.5 w-3.5" />
                  {user.id}@{emailDomain}
                </p>
              </div>
            )}

            <div>
              <p className="font-medium">{t('tokenExpires')}</p>
              <p className="text-muted-foreground text-sm">
                {timeRemaining === t('expired') ? (
                  <span className="text-destructive">{timeRemaining}</span>
                ) : (
                  <>
                    {t('expiresIn', { time: timeRemaining })}
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
              {t('logout')}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <div className="space-y-4">
            <div>
              <p className="font-medium">{t('activeSessions')}</p>
              <p className="text-muted-foreground text-sm">
                {t('manageSessionsDescription')}
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
        <h1 className="font-bold text-2xl tracking-tight">{t('sync')}</h1>
      </div>

      {authMode === 'login' ? (
        <LoginForm title={t('login')} description={t('loginDescription')} />
      ) : (
        <RegisterForm
          title={t('createAccount')}
          description={t('createAccountDescription')}
          emailDomain={emailDomain ?? undefined}
        />
      )}

      <div className="text-center text-muted-foreground text-sm">
        {authMode === 'login' ? (
          <>
            {t('noAccount')}{' '}
            <button
              type="button"
              onClick={() => setAuthMode('register')}
              className="font-medium text-primary hover:underline"
            >
              {t('createOne')}
            </button>
          </>
        ) : (
          <>
            {t('hasAccount')}{' '}
            <button
              type="button"
              onClick={() => setAuthMode('login')}
              className="font-medium text-primary hover:underline"
            >
              {t('signIn')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

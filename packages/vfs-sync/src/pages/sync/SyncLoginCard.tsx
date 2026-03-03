import { User } from 'lucide-react';
import type { ComponentType } from 'react';
import type {
  LoginFormProps,
  RegisterFormProps
} from '../../lib/authDependencies';

type AuthMode = 'login' | 'register';

interface SyncLoginCardProps {
  authMode: AuthMode;
  setAuthMode: (mode: AuthMode) => void;
  emailDomain: string | null;
  LoginForm: ComponentType<LoginFormProps>;
  RegisterForm: ComponentType<RegisterFormProps>;
  t: (key: string) => string;
}

export function SyncLoginCard({
  authMode,
  setAuthMode,
  emailDomain,
  LoginForm,
  RegisterForm,
  t
}: SyncLoginCardProps) {
  return (
    <div className="rounded-lg border bg-background p-8 text-center [border-color:var(--soft-border)]">
      <User className="mx-auto h-12 w-12 text-muted-foreground/50" />
      <p className="mt-4 text-muted-foreground">{t('loginDescription')}</p>

      <div className="mt-6">
        {authMode === 'login' ? (
          <LoginForm
            title={t('login')}
            borderless
            switchModeCta={{
              prompt: t('noAccount'),
              actionLabel: t('createOne'),
              onAction: () => setAuthMode('register')
            }}
          />
        ) : (
          <RegisterForm
            title={t('createAccount')}
            description={t('createAccountDescription')}
            emailDomain={emailDomain ?? undefined}
            borderless
            switchModeCta={{
              prompt: t('hasAccount'),
              actionLabel: t('signIn'),
              onAction: () => setAuthMode('login')
            }}
          />
        )}
      </div>
    </div>
  );
}

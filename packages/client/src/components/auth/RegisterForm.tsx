import {
  PASSWORD_COMPLEXITY_ERROR,
  PASSWORD_MIN_LENGTH,
  passwordMeetsComplexity
} from '@tearleads/shared';
import { useCallback, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { useAuth } from '@/contexts/AuthContext';

/** Delay before scrolling input into view, allowing keyboard to fully appear */
const SCROLL_INTO_VIEW_DELAY_MS = 300;

/**
 * Scroll an input element into view after keyboard appears.
 * Uses a delay to allow the keyboard to fully open and viewport to resize.
 */
function scrollInputIntoView(element: HTMLInputElement) {
  setTimeout(() => {
    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, SCROLL_INTO_VIEW_DELAY_MS);
}

interface RegisterFormProps {
  /** Title displayed above the form */
  title?: string | undefined;
  /** Description text displayed below the title */
  description?: string | undefined;
  /** Allowed email domain hint (e.g., "example.com") */
  emailDomain?: string | undefined;
  /** Optional CTA to switch auth modes (e.g., sign in) */
  switchModeCta?:
    | {
        prompt: string;
        actionLabel: string;
        onAction: () => void;
      }
    | undefined;
}

export function RegisterForm({
  title = 'Create Account',
  description = 'Register for a new account',
  emailDomain,
  switchModeCta
}: RegisterFormProps) {
  const id = useId();
  const { authError, clearAuthError, register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  const handleInputFocus = useCallback(
    (ref: React.RefObject<HTMLInputElement | null>) => {
      if (ref.current) {
        scrollInputIntoView(ref.current);
      }
    },
    []
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      clearAuthError();

      // Client-side validation
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }

      if (password.length < PASSWORD_MIN_LENGTH) {
        // COMPLIANCE_SENTINEL: TL-ACCT-001 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=password-complexity
        setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
        return;
      }

      if (!passwordMeetsComplexity(password)) {
        // COMPLIANCE_SENTINEL: TL-ACCT-001 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=password-complexity
        setError(PASSWORD_COMPLEXITY_ERROR);
        return;
      }

      setIsSubmitting(true);

      try {
        await register(email, password);
        setEmail('');
        setPassword('');
        setConfirmPassword('');
      } catch (err) {
        setError(
          typeof err === 'string'
            ? err
            : err instanceof Error
              ? err.message
              : 'Registration failed. Please try again.'
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [email, password, confirmPassword, register, clearAuthError]
  );

  const isFormValid =
    email.length > 0 &&
    password.length >= PASSWORD_MIN_LENGTH &&
    passwordMeetsComplexity(password) &&
    confirmPassword.length > 0;

  return (
    <div className="rounded-lg border p-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>

        {authError && (
          <div className="rounded-md bg-destructive/10 p-3 text-destructive text-sm">
            {authError}
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-destructive text-sm">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor={`${id}-email`} className="font-medium text-sm">
            Email
          </label>
          <Input
            ref={emailRef}
            id={`${id}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={() => handleInputFocus(emailRef)}
            placeholder={emailDomain ? `you@${emailDomain}` : 'you@example.com'}
            required
            disabled={isSubmitting}
            autoComplete="email"
          />
          {emailDomain && (
            <p className="text-muted-foreground text-xs">
              Registration is limited to @{emailDomain} email addresses
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor={`${id}-password`} className="font-medium text-sm">
            Password
          </label>
          <PasswordInput
            ref={passwordRef}
            id={`${id}-password`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onFocus={() => handleInputFocus(passwordRef)}
            placeholder="Create a password"
            required
            disabled={isSubmitting}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
          />
          <p className="text-muted-foreground text-xs">
            Minimum {PASSWORD_MIN_LENGTH} characters, including uppercase,
            lowercase, number, and symbol
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor={`${id}-confirm-password`}
            className="font-medium text-sm"
          >
            Confirm Password
          </label>
          <PasswordInput
            ref={confirmPasswordRef}
            id={`${id}-confirm-password`}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onFocus={() => handleInputFocus(confirmPasswordRef)}
            placeholder="Confirm your password"
            required
            disabled={isSubmitting}
            autoComplete="new-password"
            ariaLabelBase="confirm password"
          />
        </div>

        <Button
          type="submit"
          disabled={isSubmitting || !isFormValid}
          className="w-full"
        >
          {isSubmitting ? 'Creating account...' : 'Create Account'}
        </Button>

        {switchModeCta ? (
          <div className="text-center text-muted-foreground text-sm">
            {switchModeCta.prompt}{' '}
            <button
              type="button"
              onClick={switchModeCta.onAction}
              className="font-medium text-primary hover:underline"
            >
              {switchModeCta.actionLabel}
            </button>
          </div>
        ) : null}
      </form>
    </div>
  );
}

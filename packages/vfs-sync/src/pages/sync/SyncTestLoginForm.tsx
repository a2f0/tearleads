import { type FormEvent, useState } from 'react';
import type { LoginFormProps } from '../../lib/authDependencies';
import { mockLogin, setAuthState } from './syncTestAuthState';

export function SyncTestLoginForm({
  title,
  description,
  switchModeCta
}: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await mockLogin(email, password);
      setAuthState({
        isAuthenticated: true,
        user: result.user,
        isLoading: false,
        tokenExpiresMs: Date.now() + result.expiresIn * 1000
      });
    } catch (submitError) {
      if (submitError instanceof Error) {
        setError(submitError.message);
      } else if (typeof submitError === 'string') {
        setError(submitError);
      } else {
        setError('Login failed. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2>{title}</h2>
      <p>{description}</p>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="submit" disabled={!email || !password || isSubmitting}>
        {isSubmitting ? 'Signing in...' : 'Sign In'}
      </button>
      {switchModeCta ? (
        <button type="button" onClick={switchModeCta.onAction}>
          {switchModeCta.actionLabel}
        </button>
      ) : null}
      {error ? <div>{error}</div> : null}
    </form>
  );
}

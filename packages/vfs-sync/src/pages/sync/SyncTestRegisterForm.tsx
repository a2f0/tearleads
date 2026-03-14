import type { RegisterFormProps } from '../../lib/authDependencies';

export function SyncTestRegisterForm({
  title,
  description,
  emailDomain,
  switchModeCta
}: RegisterFormProps) {
  return (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
      {emailDomain ? <p>{emailDomain}</p> : null}
      {switchModeCta ? (
        <button type="button" onClick={switchModeCta.onAction}>
          {switchModeCta.actionLabel}
        </button>
      ) : null}
      <button type="button">Create Account</button>
    </div>
  );
}

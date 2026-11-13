import { useEffect, useId, useRef, useState } from "react";

export function ScreensaverUnlock({
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  useEffect(() => {
    if (!busy) input.current?.focus();
  }, [busy]);
  return (
    <form
      className="screensaver-unlock"
      aria-label="Unlock screensaver"
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !pin) return;
        onSubmit(pin);
        setPin("");
      }}
    >
      <h2>Return to your session</h2>
      <p>Enter your PIN code to return.</p>
      <label>
        PIN code
        <input
          ref={input}
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          required
          value={pin}
          disabled={busy}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => setPin(event.currentTarget.value)}
        />
      </label>
      {error && (
        <p id={errorId} role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Unlocking…" : "Unlock"}
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

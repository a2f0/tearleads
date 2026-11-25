import type { TwoFactorAnswer } from "@tearleads/client-sdk";
import { type FormEvent, useState } from "react";
import {
  MiniAppButton,
  MiniAppField,
  MiniAppInput,
  MiniAppToolbar,
} from "../mini-app/MiniAppLayout";
import "./TwoFactorForms.css";

/**
 * Confirms a change to two-factor settings with an authenticator code, or a
 * recovery code when the authenticator is lost.
 */
export function TwoFactorAnswerForm({
  busy,
  busyLabel,
  danger = false,
  label,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly busyLabel: string;
  readonly danger?: boolean;
  readonly label: string;
  readonly onSubmit: (answer: TwoFactorAnswer) => Promise<boolean>;
}) {
  const [code, setCode] = useState("");
  const [method, setMethod] = useState<TwoFactorAnswer["method"]>("totp");
  const recovery = method === "recovery_code";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.trim().length === 0) return;
    await onSubmit({ code: code.trim(), method });
    setCode("");
  };

  return (
    <form
      aria-label={label}
      className="two-factor-answer"
      onSubmit={(event) => void submit(event)}
    >
      <MiniAppField>
        <span>{recovery ? "Recovery code" : "Authenticator code"}</span>
        <MiniAppInput
          autoComplete="one-time-code"
          inputMode={recovery ? "text" : "numeric"}
          onChange={(event) => setCode(event.currentTarget.value)}
          placeholder={recovery ? "xxxxx-xxxxx" : "123456"}
          value={code}
        />
      </MiniAppField>
      <MiniAppToolbar>
        <MiniAppButton
          disabled={code.trim().length === 0}
          loading={busy}
          type="submit"
          variant={danger ? "danger" : "default"}
        >
          {busy ? busyLabel : label}
        </MiniAppButton>
        <MiniAppButton
          onClick={() => {
            setCode("");
            setMethod(recovery ? "totp" : "recovery_code");
          }}
          type="button"
          variant="ghost"
        >
          {recovery ? "Use authenticator code" : "Use a recovery code"}
        </MiniAppButton>
      </MiniAppToolbar>
    </form>
  );
}

import type { SessionTwoFactorCode } from "@tearleads/client-sdk";
import { type FormEvent, useId, useState } from "react";
import {
  MiniAppButton,
  MiniAppCheckbox,
  MiniAppField,
  MiniAppInput,
  MiniAppToolbar,
} from "../mini-app/MiniAppLayout";
import "./TwoFactorForms.css";

/**
 * Asks for the second factor sign-in is waiting on: an authenticator code,
 * or one of the recovery codes for a lost authenticator.
 */
export function TwoFactorSignInForm({
  authenticate,
  authenticating,
}: {
  readonly authenticate: (twoFactor: SessionTwoFactorCode) => Promise<boolean>;
  readonly authenticating: boolean;
}) {
  const [code, setCode] = useState("");
  const [method, setMethod] = useState<SessionTwoFactorCode["method"]>("totp");
  const [rememberDevice, setRememberDevice] = useState(false);
  const recovery = method === "recovery_code";
  const rememberId = useId();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.trim().length === 0) return;
    const signedIn = await authenticate({
      code: code.trim(),
      method,
      rememberDevice,
    });
    if (!signedIn) setCode("");
  };

  return (
    <form
      className="two-factor-sign-in"
      onSubmit={(event) => void submit(event)}
    >
      <MiniAppField>
        <span>{recovery ? "Recovery code" : "Authenticator code"}</span>
        <MiniAppInput
          autoComplete="one-time-code"
          autoFocus
          inputMode={recovery ? "text" : "numeric"}
          onChange={(event) => setCode(event.currentTarget.value)}
          placeholder={recovery ? "xxxxx-xxxxx" : "123456"}
          value={code}
        />
      </MiniAppField>
      <label className="two-factor-remember" htmlFor={rememberId}>
        <MiniAppCheckbox
          checked={rememberDevice}
          id={rememberId}
          onChange={(event) => setRememberDevice(event.currentTarget.checked)}
        />
        <span>Remember this device for 30 days</span>
      </label>
      <MiniAppToolbar>
        <MiniAppButton
          disabled={code.trim().length === 0}
          loading={authenticating}
          type="submit"
        >
          {authenticating ? "Verifying..." : "Verify"}
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

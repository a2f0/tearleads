import type { TwoFactorSetup } from "@tearleads/client-sdk";
import encodeQR from "qr";
import { type FormEvent, useId, useMemo, useState } from "react";
import {
  MiniAppButton,
  MiniAppCheckbox,
  MiniAppCopyValue,
  MiniAppField,
  MiniAppInput,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";

/** Groups the key in fours so it is easier to type into an authenticator. */
function groupedKey(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

export function TwoFactorSetupView({
  busy,
  onCancel,
  onEnable,
  setup,
}: {
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onEnable: (code: string, rememberDevice: boolean) => void;
  readonly setup: TwoFactorSetup;
}) {
  const [code, setCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const rememberId = useId();
  const image = useMemo(
    () =>
      `data:image/svg+xml,${encodeURIComponent(
        encodeQR(setup.otpauthUri, "svg", { border: 4, ecc: "medium" }),
      )}`,
    [setup.otpauthUri],
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.trim().length > 0) onEnable(code.trim(), rememberDevice);
  };

  return (
    <div className="two-factor-setup">
      <MiniAppStatus>
        Scan this code with an authenticator app, or enter the key by hand. Then
        enter the 6-digit code the app shows.
      </MiniAppStatus>
      <img
        alt="Authenticator setup QR code"
        className="two-factor-qr-image"
        height={240}
        src={image}
        width={240}
      />
      <div className="two-factor-key">
        <span>Setup key</span>
        <MiniAppCopyValue
          display={groupedKey(setup.secret)}
          label="setup key"
          value={setup.secret}
        />
      </div>
      <form className="two-factor-answer" onSubmit={submit}>
        <MiniAppField>
          <span>Authenticator code</span>
          <MiniAppInput
            autoComplete="one-time-code"
            inputMode="numeric"
            onChange={(event) => setCode(event.currentTarget.value)}
            placeholder="123456"
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
            loading={busy}
            type="submit"
          >
            {busy ? "Turning on..." : "Turn on"}
          </MiniAppButton>
          <MiniAppButton onClick={onCancel} type="button" variant="ghost">
            Cancel
          </MiniAppButton>
        </MiniAppToolbar>
      </form>
    </div>
  );
}

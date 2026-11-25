import {
  MiniAppButton,
  MiniAppClipboardButton,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";

/** New recovery codes, shown once until the person says they saved them. */
export function TwoFactorRecoveryCodesView({
  onDone,
  recoveryCodes,
}: {
  readonly onDone: () => void;
  readonly recoveryCodes: readonly string[];
}) {
  return (
    <div className="two-factor-codes">
      <MiniAppStatus>
        Save these recovery codes somewhere safe. Each one signs in once if you
        lose your authenticator. They will not be shown again.
      </MiniAppStatus>
      <ol aria-label="Recovery codes" className="two-factor-code-list">
        {recoveryCodes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <MiniAppToolbar>
        <MiniAppClipboardButton
          label="Copy recovery codes"
          value={() => recoveryCodes.join("\n")}
        />
        <MiniAppButton onClick={onDone} type="button">
          I saved them
        </MiniAppButton>
      </MiniAppToolbar>
    </div>
  );
}

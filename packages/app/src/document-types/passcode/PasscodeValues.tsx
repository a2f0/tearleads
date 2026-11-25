import { type ReactNode, useState } from "react";
import { MiniAppKeyValueRow } from "../../components/mini-app/tables/MiniAppKeyValueList";
import { classNames } from "../../components/shared/classNames";
import { DocumentSecretActions } from "../shared/DocumentSecretActions";

// A fixed-width mask, like KeePassX's: it never reveals the secret's length.
export const PASSCODE_MASK = "••••••••";
const PASSCODE_EMPTY_VALUE = "None";

/** A plain label/value row; blank values read "None". */
export function PasscodeReadRow(params: {
  label: string;
  multiline?: boolean | undefined;
  value: string;
}) {
  const isEmpty = params.value.trim().length === 0;
  return (
    <MiniAppKeyValueRow label={params.label}>
      <span
        className={classNames(
          "passcode-value",
          params.multiline && "passcode-value--multiline",
          isEmpty && "passcode-value--empty",
        )}
      >
        {isEmpty ? PASSCODE_EMPTY_VALUE : params.value}
      </span>
    </MiniAppKeyValueRow>
  );
}

/**
 * A secret's row: masked until its own eye is pressed, with a copy button
 * that copies the stored value. Its reveal state is this row's alone, so a
 * value is never shown by anything but an explicit press, and leaving read
 * mode (which unmounts the row) masks it again.
 */
export function PasscodeSecretReadRow(params: {
  label: string;
  revealLabel: string;
  value: string;
}) {
  const [isRevealed, setIsRevealed] = useState(false);
  if (params.value.length === 0) {
    return <PasscodeReadRow label={params.label} value="" />;
  }

  return (
    <MiniAppKeyValueRow label={params.label}>
      <span className="passcode-secret">
        <span
          className={classNames(
            "passcode-value",
            !isRevealed && "passcode-value--masked",
          )}
        >
          {isRevealed ? params.value : PASSCODE_MASK}
        </span>
        <span className="passcode-secret-actions">
          <DocumentSecretActions
            isRevealed={isRevealed}
            label={params.revealLabel}
            onToggle={() => setIsRevealed((revealed) => !revealed)}
            value={params.value}
          />
        </span>
      </span>
    </MiniAppKeyValueRow>
  );
}

/** One label/control row of the edit form, label right-aligned beside it. */
export function PasscodeFormRow(params: {
  children: ReactNode;
  inputId: string;
  label: string;
}) {
  return (
    <div className="passcode-form-row">
      <label htmlFor={params.inputId}>{params.label}</label>
      <div className="passcode-form-control">{params.children}</div>
    </div>
  );
}

/** A masked input with its eye and copy button, masked whenever it mounts. */
export function PasscodeSecretInput(params: {
  ariaLabel?: string | undefined;
  disabled: boolean;
  id?: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  revealLabel: string;
  value: string;
}) {
  const [isRevealed, setIsRevealed] = useState(false);

  return (
    <>
      <input
        aria-label={params.ariaLabel}
        autoCapitalize="off"
        // Browsers ignore "off" on password inputs; "new-password" keeps them
        // from filling in this site's own login.
        autoComplete="new-password"
        autoCorrect="off"
        disabled={params.disabled}
        id={params.id}
        onChange={(event) => params.onChange(event.target.value)}
        placeholder={params.placeholder}
        spellCheck={false}
        type={isRevealed ? "text" : "password"}
        value={params.value}
      />
      <DocumentSecretActions
        disabled={params.disabled}
        isRevealed={isRevealed}
        label={params.revealLabel}
        onToggle={() => setIsRevealed((revealed) => !revealed)}
        value={params.value}
      />
    </>
  );
}

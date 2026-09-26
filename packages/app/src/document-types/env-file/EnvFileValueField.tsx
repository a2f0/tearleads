import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { type ChangeEventHandler, useState } from "react";
import { MiniAppButton } from "../../components/mini-app/MiniAppLayout";
import { TrackerInputField } from "../shared/TrackerFormControls";

export function EnvFileValueField(params: {
  ariaLabel: string;
  disabled: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  value: string;
}) {
  const { ariaLabel, disabled, onChange, value } = params;
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);
  const supportsTextSecurity =
    typeof CSS !== "undefined" &&
    CSS.supports?.("-webkit-text-security", "disc");
  const revealAction = `${revealed ? "Hide" : "Show"} ${ariaLabel}`;
  // Browsers without CSS text masking show bullets until the field is focused.
  const displayValue =
    !revealed && !focused && !supportsTextSecurity
      ? "•".repeat(value.length)
      : value;

  return (
    <TrackerInputField
      action={
        <MiniAppButton
          aria-label={revealAction}
          aria-pressed={revealed}
          className="mini-app-icon-button"
          disabled={disabled || value.length === 0}
          onClick={() => setRevealed((current) => !current)}
          title={revealAction}
          variant="ghost"
        >
          {revealed ? (
            <EyeSlashIcon aria-hidden size={16} />
          ) : (
            <EyeIcon aria-hidden size={16} />
          )}
        </MiniAppButton>
      }
      aria-label={ariaLabel}
      autoCapitalize="off"
      autoComplete="off"
      className={`env-file-variable-value-field${revealed ? " env-file-variable-value-revealed" : ""}`}
      disabled={disabled}
      label="Value"
      onBlur={() => setFocused(false)}
      onChange={onChange}
      onFocus={() => setFocused(true)}
      placeholder="secret"
      spellCheck={false}
      type="text"
      value={displayValue}
    />
  );
}

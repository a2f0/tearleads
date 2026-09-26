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
  const supportsTextSecurity =
    typeof CSS !== "undefined" &&
    CSS.supports?.("-webkit-text-security", "disc");
  const revealAction = `${revealed ? "Hide" : "Show"} ${ariaLabel}`;
  // Browsers without CSS text masking require Show before editing the value.
  const displayValue =
    !revealed && !supportsTextSecurity ? "•".repeat(value.length) : value;

  return (
    <TrackerInputField
      action={
        <MiniAppButton
          aria-label={revealAction}
          aria-pressed={revealed}
          className="mini-app-icon-button"
          disabled={disabled || (value.length === 0 && supportsTextSecurity)}
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
      onChange={onChange}
      placeholder="secret"
      readOnly={!revealed && !supportsTextSecurity}
      spellCheck={false}
      type="text"
      value={displayValue}
    />
  );
}
